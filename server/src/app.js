// One Express app. /api = health, scenarios, evaluate, three-lo, diagram, info and reset. The only server state is each
// workspace's recent evaluations, kept per workspace id (X-Workspace) so one visitor's Reset never touches another's.
// Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { loadCast, verticalFrom, VERTICALS } from './cast.js';
import { createMode, MODES } from './mode.js';
import { NO_LIVE } from './releaseClaims.js';
import { buildStory } from './story.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { ClaimsInputError, evaluateClaims } from './claims.js';
import { ThreeLoInputError, evaluateThreeLoScenario } from './threeLo.js';
import { buildThreeLoStory } from './threeLoStory.js';
import { buildHops, newTrace } from './trace.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';
import { createReleaseRouter } from './releaseRoutes.js';
import { maskDeep, maskTypedDeep } from './mask.js';
import { realM2m } from './realEngine.js';
import { createPending, realThreeLoComplete, realThreeLoStart } from './realThreeLo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

export function createApp({ health = createHealth(), configFile = CONFIG, workspaces = createWorkspaces(), mode = createMode() } = {}) {
  const realThreeLo = { result: null, lastError: null };
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  // Defence in depth: every JSON answer of every endpoint is masked for credential-shaped values, whatever path produced it (a customer.config.json value, a
  // typed value that was shown back). Hop panes and signatures are left alone (see mask.js).
  api.use((_req, res, next) => { const send = res.json.bind(res); res.json = (b) => send(maskDeep(b)); next(); });
  api.use('/health', health.router);
  const castFor = (req) => loadCast(configFile, verticalFrom(req.query.vertical));
  // customer.config.json is read on every request so editing it shows up on reload.
  api.get('/scenarios', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...buildStory(castFor(req)), verticals: Object.keys(VERTICALS) }); });
  api.get('/diagram', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : 'm2m-gate')); });
  api.get('/three-lo', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...buildThreeLoStory(castFor(req)), tokenLabel: 'MOCK values: invented for education, never a real credential', simulated: true }); });
  // Rule 19: what this build is, and the Mock/Real switch: GET /api/info returns source and realAvailable;
  // POST /api/mode with exactly {"source"} switches at runtime; Real unconfigured -> 409 with the how-to.
  api.get('/info', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...mode.info(), liveRefusal: NO_LIVE, simulated: mode.source() !== 'real' }); });
  api.post('/mode', (req, res) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 1 || !MODES.includes(b.source)) return res.status(400).json({ error: 'bad_request', detail: 'body must be exactly {"source": "mock" or "real"}' });
    if (b.source === 'real' && mode.info().realAvailable !== true) return res.status(409).json({ error: 'conflict', message: mode.info().realReason });
    mode.set(b.source);
    return res.json({ ...mode.info(), simulated: b.source !== 'real' });
  });

  const withWorkspace = (handler) => (req, res) => {
    const ws = workspaceFrom(req);
    if (!ws) return res.status(400).json({ error: 'bad_workspace' });
    res.set('Cache-Control', 'no-store');
    return handler(ws, req, res);
  };
  // Evaluate a scenario by id, or a custom { token, rule }. Input is bounded in size, depth and count (claims.js).
  api.post('/evaluate', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    let token; let rule; let scenario = null;
    const story = buildStory(castFor(req));
    if (body.scenario !== undefined) {
      scenario = typeof body.scenario === 'string' ? story.scenarios.find((s) => s.id === body.scenario) : null;
      if (!scenario) return res.status(400).json({ error: 'unknown_scenario' });
      token = scenario.token.claims; rule = story.rule;
    } else { token = body.token; rule = body.rule; }
    try {
      const result = evaluateClaims(token, rule);
      const run = { scenario: scenario ? scenario.id : 'custom', decision: result.decision };
      workspaces.record(ws, run);
      const trace = newTrace(req.headers.traceparent);
      const hops = buildHops({ trace, cast: story.cast, decision: result.decision, reasonCodes: result.checks.map((c) => c.reason), scenario: run.scenario });
      res.set('traceparent', hops[0].traceparent);
      // A custom token and rule are the visitor's own text: what the answer quotes back (claim names and values, the checks) is masked if credential-shaped.
      const typed = scenario ? { checks: result.checks, flat: result.flat } : maskTypedDeep({ checks: result.checks, flat: result.flat });
      return res.json({ ...result, ...typed, scenario: run.scenario, expected: scenario ? scenario.expected : null, workspace: ws, traceId: trace.traceId, hops });
    } catch (e) {
      if (e instanceof ClaimsInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));
  // The USER_FEDERATION (3LO) scenarios: by scenario id only (their inputs are fixed data, so there is nothing to bound).
  api.post('/three-lo/evaluate', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    try {
      const out = evaluateThreeLoScenario(buildThreeLoStory(castFor(req)), body.scenario, req.headers.traceparent);
      workspaces.record(ws, { scenario: `three-lo:${out.scenario}`, decision: out.decision });
      res.set('traceparent', out.traceparent);
      return res.json({ ...out, scenario: out.scenario, workspace: ws });
    } catch (e) {
      if (e instanceof ThreeLoInputError) return res.status(400).json({ error: e.code, detail: e.message });
      throw e;
    }
  }));
  // The H2 2026 release tab (on-behalf-of): see releaseRoutes.js.
  api.use(createReleaseRouter({ castOf: (vertical) => loadCast(configFile, vertical), workspaces }));
  // Real engine: one live M2M run through AWS AgentCore Identity -> PingOne. Available only when the owner set
  // APD_REAL_ENGINE=1 and the AWS + workload settings; the route 409s with the how-to otherwise. Scope is bounded
  // to the shape the PingOne resource grants (orders:read / orders:write), so this endpoint cannot mint arbitrary
  // tokens. The raw token is returned (rule 4: tokens shown raw, education) - it is real and short-lived.
  const REAL_SCOPES = new Set(['orders:read', 'orders:write']);
  // Real 3LO: the pre-registration map (gotcha 12/13). sessionUri -> { userId, scope, wat }. The callback can
  // only be reached by AgentCore's redirect, so the map never leaks user ids to the browser.
  const threeLoPending = createPending();
  api.post('/real/3lo/start', withWorkspace((ws, req, res) => {
    if (mode.info().realAvailable !== true) return res.status(409).json({ error: 'conflict', message: mode.info().realReason });
    const b = req.body || {};
    const scope = typeof b.scope === 'string' ? b.scope : 'orders:read';
    if (!REAL_SCOPES.has(scope)) return res.status(400).json({ error: 'bad_request', detail: 'scope must be orders:read or orders:write' });
    realThreeLoStart({ scope, userId: b.userId }).then((out) => {
      if (out.ok) threeLoPending.set(out.sessionUri, { userId: out.userId, scope: out.scope, wat: out.wat });
      res.json(out);
    }).catch((e) => res.status(502).json({ ok: false, error: `real 3LO: ${e.message}` }));
  }));
  // AgentCore redirects here with ?session_id=<sessionUri>. The response is a browser-facing page, so it
  // bypasses the JSON masker (nothing user-shaped is echoed: no sessionUri, no token).
  // The UI polls this after opening the authorizationUrl.
  api.get('/real/3lo/result', withWorkspace((ws, _req, res) => {
    if (realThreeLo.lastError) { const e = realThreeLo.lastError; realThreeLo.lastError = null; return res.json({ ok: false, error: e }); }
    const r = realThreeLo.result;
    if (r) realThreeLo.result = null;
    res.json(r ? { ...r } : { ok: false, pending: true });
  }));
  api.get('/real/callback', (req, res) => {
    const sessionUri = typeof req.query.session_id === 'string' ? req.query.session_id : '';
    if (!sessionUri || sessionUri.length > 512) return res.status(400).type('text').send('Bad callback: missing session');
    realThreeLoComplete({ sessionUri }, threeLoPending).then((out) => {
      if (!out.ok) { realThreeLo.lastError = out.error; return res.status(502).type('text').send('Real 3LO failed: see the lab UI for the reason.'); }
      realThreeLo.result = out;
      workspaces.record('default', { scenario: `real-3lo:${out.scope}`, decision: 'real' });
      res.type('html').send('<!doctype html><title>Real 3LO complete</title><body style="font-family:system-ui;max-width:40rem;margin:4rem auto"><h1>Sign-in complete</h1><p>The real PingOne token for this human is in the lab. Go back to the lab tab - the Real tab shows the decoded claims.</p></body>');
    })
      .catch((e) => { realThreeLo.lastError = e.message; res.status(502).type('text').send('Real 3LO failed.'); });
  });
  api.post('/real/m2m', withWorkspace((ws, req, res) => {
    if (mode.info().realAvailable !== true) return res.status(409).json({ error: 'conflict', message: mode.info().realReason });
    const scope = req.body && typeof req.body.scope === 'string' ? req.body.scope : 'orders:read';
    if (!REAL_SCOPES.has(scope)) return res.status(400).json({ error: 'bad_request', detail: 'scope must be orders:read or orders:write' });
    realM2m({ scope }).then((out) => {
      if (out.ok) workspaces.record(ws, { scenario: `real-m2m:${scope}`, decision: 'real' });
      res.json(out);
    }).catch((e) => res.status(502).json({ ok: false, error: `real engine: ${e.message}` }));
  }));
  api.get('/runs', withWorkspace((ws, _req, res) => res.json(workspaces.runs(ws))));
  // Reset clears this workspace's evaluations only.
  api.post('/reset', withWorkspace((ws, _req, res) => { workspaces.reset(ws); res.json({ reset: 'ok', workspace: ws }); }));
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  // Prefix-tolerant callback (measured gotcha: behind the shared lab-proxy, a registered return URL that carries
  // the app's path prefix arrives here UN-stripped - /agentcore-pingone/api/real/callback - because the proxy only
  // strips the prefix on its exact entry route). The SPA catch-all below would silently answer it with index.html,
  // which looks like success while the flow dies with "unknown session". So: any path ENDING in /api/real/callback
  // is routed into the API router, whatever prefix it arrived with. The canonical /api/real/callback above already
  // matched; this catches the prefixed spelling and any future mount path.
  app.use((req, res, next) => {
    if (typeof req.path === 'string' && /\/api\/real\/callback$/.test(req.path)) {
      req.url = req.path.slice(req.path.indexOf('/api/') + 4);
      return api(req, res, next);
    }
    return next();
  });
  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  // The last two handlers catch everything that is left, for every method and every path: Express's default answers ("Cannot POST /<path>", or an HTML
  // stack trace with file paths) would echo the path the visitor typed, which may be a token. Fixed JSON, no path.
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
