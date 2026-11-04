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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

export function createApp({ health = createHealth(), configFile = CONFIG, workspaces = createWorkspaces(), mode = createMode() } = {}) {
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
  api.get('/info', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...mode.info(), liveRefusal: NO_LIVE, simulated: true }); });
  api.post('/mode', (req, res) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 1 || !MODES.includes(b.source)) return res.status(400).json({ error: 'bad_request', detail: 'body must be exactly {"source": "mock" or "real"}' });
    if (b.source === 'real' && mode.info().realAvailable !== true) return res.status(409).json({ error: 'conflict', message: mode.info().realReason });
    mode.set(b.source);
    return res.json({ ...mode.info(), simulated: true });
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
  api.get('/runs', withWorkspace((ws, _req, res) => res.json(workspaces.runs(ws))));
  // Reset clears this workspace's evaluations only.
  api.post('/reset', withWorkspace((ws, _req, res) => { workspaces.reset(ws); res.json({ reset: 'ok', workspace: ws }); }));
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
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
