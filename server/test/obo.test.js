// On-behalf-of engine and API. Every check and every editable field is pinned by a case that fails when that check or field is ignored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VERTICALS, DEFAULT_CAST, fillDeep } from '../src/cast.js';
import { BACKENDS, GATEWAY_AUD, LAB_NOW, MAX_ACT_DEPTH, OBO_CONFIG, TRUSTED_ISSUER } from '../src/oboData.js';
import { actChain, backendValidate, canonical, exchangeOnBehalfOf, issueMockToken, mockSignature, parseScope, signatureValid } from '../src/obo.js';
import { buildOboStory, evaluateOboScenario, normalizeOverrides } from '../src/oboStory.js';
import { call, withServer } from './helpers.js';

const cast = DEFAULT_CAST;
const cfg = { now: LAB_NOW, gatewayAud: fillDeep(GATEWAY_AUD, cast), trustedIssuer: fillDeep(TRUSTED_ISSUER, cast), exchangeClientId: OBO_CONFIG.ClientID, maxActDepth: MAX_ACT_DEPTH, lifetime: 300 };
const backends = BACKENDS.map((b) => ({ id: b.id, resource: fillDeep(b.resource, cast), scopes: b.scopes }));
const ORDERS = backends[0].resource; const REPORTS = backends[1].resource;
const claims = (extra = {}) => ({ iss: cfg.trustedIssuer, sub: 'user-1001', aud: cfg.gatewayAud, client_id: 'orders-agent', scope: 'orders:read orders:write', iat: LAB_NOW - 300, exp: LAB_NOW + 300, jti: 'j-1', ...extra });
const run = ({ inboundClaims = claims(), tamper, resource = ORDERS, scope = ['orders:read'], seen = new Set(), c = cfg } = {}) => {
  const inbound = issueMockToken(inboundClaims);
  if (tamper) inbound.claims = { ...inbound.claims, ...tamper };
  return { inbound, result: exchangeOnBehalfOf({ inbound, request: { resource, scope }, cfg: c, backends, seen }), seen };
};
const code = (o) => run(o).result.code;

test('every scenario gives its expected decision and refusal code in every vertical, and the replay scenario runs twice', () => {
  for (const [name, v] of Object.entries(VERTICALS)) {
    const st = buildOboStory(v);
    assert.equal(st.scenarios.length, 13);
    for (const sc of st.scenarios) {
      const out = evaluateOboScenario(st, sc.id, {}, v);
      assert.equal(out.result.decision, sc.expected, `${name}/${sc.id}`);
      assert.equal(out.result.code, sc.code, `${name}/${sc.id}`);
      assert.equal(out.steps.length, sc.replay ? 2 : 1);
      assert.equal(out.hops.length, 3);
    }
    const replay = evaluateOboScenario(st, 'replay', {}, v);
    assert.deepEqual(replay.steps.map((s) => s.result.decision), ['allow', 'deny']);
  }
});

test('the exchanged token is computed: aud is the backend, sub the user, act names the caller, it differs from the caller token and its signature verifies', () => {
  const { inbound, result } = run();
  const ex = result.exchanged;
  assert.equal(result.decision, 'allow');
  assert.equal(ex.claims.aud, ORDERS);
  assert.equal(ex.claims.sub, 'user-1001');
  assert.deepEqual(ex.claims.act, { sub: 'orders-agent' });
  assert.equal(ex.claims.scope, 'orders:read');
  assert.notEqual(canonical(ex.claims), canonical(inbound.claims));
  assert.ok(signatureValid(ex));
  assert.equal(ex.signature, mockSignature(ex.claims));
});

test('the backend accepts the exchanged token and rejects the caller\'s own (computed, not typed in)', () => {
  const { inbound, result } = run();
  assert.equal(backendValidate(result.exchanged, ORDERS, LAB_NOW).accepted, true);
  assert.equal(backendValidate(inbound, ORDERS, LAB_NOW).accepted, false);
  assert.match(backendValidate(inbound, ORDERS, LAB_NOW).why, /audience/);
  assert.equal(backendValidate(result.exchanged, REPORTS, LAB_NOW).accepted, false, 'a token for one backend is not valid at another');
  assert.equal(backendValidate(result.exchanged, ORDERS, LAB_NOW + 10_000).accepted, false, 'expired');
  assert.equal(backendValidate({ ...result.exchanged, claims: { ...result.exchanged.claims, sub: 'someone-else' } }, ORDERS, LAB_NOW).accepted, false, 'tampered');
});

test('the act claim chain: an earlier actor is nested beneath the caller, one level per hop', () => {
  const { result } = run({ inboundClaims: claims({ act: { sub: 'planner-agent' } }) });
  assert.deepEqual(result.exchanged.claims.act, { sub: 'orders-agent', act: { sub: 'planner-agent' } });
  assert.deepEqual(actChain(result.exchanged.claims.act), { bad: false, chain: ['orders-agent', 'planner-agent'] });
  const two = run({ inboundClaims: claims({ act: { sub: 'a', act: { sub: 'b' } } }) });
  assert.equal(two.result.decision, 'allow');
  assert.equal(actChain(two.result.exchanged.claims.act).chain.length, 3);
});

test('signature: changing ANY claim after signing refuses with bad_signature', () => {
  for (const tamper of [{ sub: 'other' }, { aud: 'x' }, { scope: 'orders:read orders:write admin:all' }, { exp: LAB_NOW + 9999 }, { iss: 'x' }, { jti: 'j-2' }]) assert.equal(code({ tamper }), 'bad_signature', JSON.stringify(tamper));
  assert.equal(signatureValid({ claims: claims(), signature: 5 }), false);
  assert.equal(signatureValid(null), false);
  assert.equal(signatureValid({ claims: 'x', signature: 'y' }), false);
});

test('issuer: only the configured issuer is exchanged', () => {
  assert.equal(code({ inboundClaims: claims({ iss: 'https://rogue.example' }) }), 'untrusted_issuer');
  assert.equal(code({ inboundClaims: claims({ iss: undefined }) }), 'untrusted_issuer');
  assert.equal(code({ c: { ...cfg, trustedIssuer: 'https://other.example' } }), 'untrusted_issuer', 'the configured issuer is what counts');
});

test('expiry: exp equal to the lab clock is expired, one second later is not; a missing or text exp is expired', () => {
  assert.equal(code({ inboundClaims: claims({ exp: LAB_NOW }) }), 'expired');
  assert.equal(code({ inboundClaims: claims({ exp: LAB_NOW + 1 }) }), null);
  assert.equal(code({ inboundClaims: claims({ exp: 'soon' }) }), 'expired');
  assert.equal(code({ inboundClaims: claims({ exp: undefined }) }), 'expired');
  assert.equal(code({ c: { ...cfg, now: LAB_NOW + 1000 } }), 'expired', 'the lab clock is what counts');
});

test('audience: the gateway must be named; an aud list that includes it is fine, a list without it is not', () => {
  assert.equal(code({ inboundClaims: claims({ aud: 'https://other.example' }) }), 'wrong_audience');
  assert.equal(code({ inboundClaims: claims({ aud: ['https://other.example', cfg.gatewayAud] }) }), null);
  assert.equal(code({ inboundClaims: claims({ aud: ['https://other.example'] }) }), 'wrong_audience');
  assert.equal(code({ inboundClaims: claims({ aud: undefined }) }), 'wrong_audience');
  assert.equal(code({ inboundClaims: claims({ aud: 5 }) }), 'wrong_audience');
});

test('subject: sub must be a non-empty text', () => {
  for (const sub of ['', undefined, 5, null, ['u']]) assert.equal(code({ inboundClaims: claims({ sub }) }), 'no_subject', String(sub));
});

test('replay: the same jti is refused the second time, a refused exchange does not use the jti up, and a token without a jti is not tracked', () => {
  const seen = new Set();
  assert.equal(code({ seen }), null);
  assert.equal(code({ seen }), 'replayed');
  assert.equal(code({ seen, inboundClaims: claims({ jti: 'j-other' }) }), null, 'a different jti is a different token');
  const s2 = new Set();
  assert.equal(code({ seen: s2, scope: ['admin:all'] }), 'scope_widening');
  assert.equal(s2.size, 0, 'a refusal records nothing');
  assert.equal(code({ seen: s2 }), null, 'the retry with a valid request works');
  const s3 = new Set();
  assert.equal(code({ seen: s3, inboundClaims: claims({ jti: undefined }) }), null);
  assert.equal(code({ seen: s3, inboundClaims: claims({ jti: undefined }) }), null);
  assert.equal(s3.size, 0);
});

test('act chain: a chain at the cap is refused, one below is allowed, a malformed act is bad_act, and a huge chain is bounded', () => {
  const chainOf = (n) => { let a; for (let i = 0; i < n; i++) a = { sub: `a${i}`, ...(a ? { act: a } : {}) }; return a; };
  assert.equal(code({ inboundClaims: claims({ act: chainOf(MAX_ACT_DEPTH - 1) }) }), null);
  assert.equal(code({ inboundClaims: claims({ act: chainOf(MAX_ACT_DEPTH) }) }), 'chain_too_deep');
  assert.equal(code({ inboundClaims: claims({ act: chainOf(MAX_ACT_DEPTH) }), c: { ...cfg, maxActDepth: MAX_ACT_DEPTH + 1 } }), null, 'the configured cap is what counts');
  for (const act of ['{}', [], 5, null, {}, { sub: '' }, { sub: 5 }, { sub: 'a', act: '{}' }]) assert.equal(code({ inboundClaims: claims({ act }) }), 'bad_act', JSON.stringify(act));
  const huge = chainOf(5000);
  assert.equal(code({ inboundClaims: claims({ act: huge }) }), 'bad_act', 'walking stops at the bound');
});

test('resource: blank is resource_missing, an unlisted URL is unknown_resource, each listed backend is exchanged for', () => {
  assert.equal(code({ resource: '' }), 'resource_missing');
  assert.equal(code({ resource: 'https://mcp.example/unlisted/mcp' }), 'unknown_resource');
  assert.equal(code({ resource: REPORTS, scope: ['reports:read'], inboundClaims: claims({ scope: 'reports:read' }) }), null);
  assert.equal(run({ resource: REPORTS, scope: ['reports:read'], inboundClaims: claims({ scope: 'reports:read' }) }).result.exchanged.claims.aud, REPORTS);
});

test('scope: never wider than the caller holds, only what the backend offers, a blank request grants the overlap, duplicates collapse', () => {
  assert.equal(code({ scope: ['orders:read', 'admin:all'] }), 'scope_widening');
  assert.equal(code({ scope: ['orders:read', 'orders:write'] }), null);
  assert.equal(code({ resource: REPORTS, scope: ['orders:write'] }), 'scope_not_for_backend');
  assert.equal(run({ scope: [] }).result.exchanged.claims.scope, 'orders:read orders:write', 'blank: what the caller holds and the backend offers');
  assert.equal(run({ resource: REPORTS, scope: [], inboundClaims: claims({ scope: 'orders:read reports:read' }) }).result.exchanged.claims.scope, 'reports:read');
  assert.equal(run({ scope: parseScope('orders:read orders:read') }).result.exchanged.claims.scope, 'orders:read');
  assert.equal(code({ inboundClaims: claims({ scope: undefined }), scope: ['orders:read'] }), 'scope_widening');
});

test('lifetime: the exchanged token expires at the caller\'s exp or five minutes after the lab clock, whichever is sooner', () => {
  assert.equal(run({ inboundClaims: claims({ exp: LAB_NOW + 100 }) }).result.exchanged.claims.exp, LAB_NOW + 100);
  assert.equal(run({ inboundClaims: claims({ exp: LAB_NOW + 5000 }) }).result.exchanged.claims.exp, LAB_NOW + 300);
  assert.equal(run({ inboundClaims: claims({ exp: LAB_NOW + 5000 }), c: { ...cfg, lifetime: 60 } }).result.exchanged.claims.exp, LAB_NOW + 60);
  assert.equal(run().result.exchanged.claims.iat, LAB_NOW);
});

test('the checks run in a fixed order and a refusal says which were not reached; the verdict status and OAuth error are honest', () => {
  // the exact order is part of the contract: signature, issuer, expiry, audience, subject, replay, act chain, resource, scope
  assert.deepEqual(run({}).result.checks.map((c) => c.id), ['inbound_signature', 'inbound_issuer', 'inbound_expiry', 'inbound_audience', 'inbound_subject', 'replay', 'act_chain', 'resource', 'scope']);
  const r = run({ tamper: { sub: 'x' }, resource: '' }).result;
  assert.equal(r.code, 'bad_signature');
  assert.deepEqual(r.checks.map((c) => c.ok), [false, ...Array(8).fill(null)]);
  assert.equal(r.status, 401); assert.equal(r.oauthError, 'invalid_token');
  assert.equal(run({ resource: '' }).result.status, 400);
  assert.equal(run({ resource: '' }).result.oauthError, 'invalid_target');
  assert.equal(run({ scope: ['admin:all'] }).result.oauthError, 'invalid_scope');
  assert.equal(run({ inboundClaims: claims({ act: { sub: 'a', act: { sub: 'b', act: { sub: 'c' } } } }) }).result.status, 403);
  const ok = run().result;
  assert.equal(ok.status, 200); assert.ok(ok.checks.every((c) => c.ok === true)); assert.equal(ok.checks.length, 9);
});

test('exchangeOnBehalfOf does not mutate its inputs', () => {
  const inbound = issueMockToken(claims({ act: { sub: 'p' } }));
  const req = { resource: ORDERS, scope: ['orders:read'] };
  const before = JSON.stringify([inbound, req]);
  exchangeOnBehalfOf({ inbound, request: req, cfg, backends, seen: new Set() });
  assert.equal(JSON.stringify([inbound, req]), before);
});

test('parseScope: bounded, safe characters only, a credential-looking scope is refused and never echoed', () => {
  assert.deepEqual(parseScope('a:b c.d e_f g-h'), ['a:b', 'c.d', 'e_f', 'g-h']);
  assert.deepEqual(parseScope(''), []);
  for (const bad of [5, null, {}, 'x'.repeat(201), Array.from({ length: 11 }, (_, i) => `s${i}`).join(' '), 'a-'.repeat(32) + 'a', 'a<b', 'a/b', 'a\u0000b']) assert.throws(() => parseScope(bad), (e) => e.code === 'bad_scope', String(bad).slice(0, 20));
  try { parseScope('ghp_AbCdEfGhIjKlMnOp1234'); assert.fail('refused'); } catch (e) { assert.equal(e.code, 'credential_like'); assert.ok(!e.message.includes('ghp_')); }
});

test('normalizeOverrides: resource must be one of the listed choices, scope goes through parseScope, nothing else is read', () => {
  assert.deepEqual(normalizeOverrides({}), {});
  assert.deepEqual(normalizeOverrides({ resource: 'reports', scope: 'reports:read' }), { resource: 'reports', scope: ['reports:read'] });
  for (const bad of [5, 'https://x.example', '', 'ORDERS', null, ['orders'], '__proto__']) assert.throws(() => normalizeOverrides({ resource: bad }), (e) => e.code === 'bad_resource');
});

test('the overrides change the verdict: the backend choice and the scope text each decide', () => {
  const st = buildOboStory(cast);
  const ev = (id, o) => evaluateOboScenario(st, id, normalizeOverrides(o), cast).result;
  assert.equal(ev('no-resource', {}).code, 'resource_missing');
  assert.equal(ev('no-resource', { resource: 'orders' }).decision, 'allow', 'choosing a backend fixes it');
  assert.equal(ev('allowed', { resource: 'none' }).code, 'resource_missing');
  assert.equal(ev('allowed', { resource: 'unlisted' }).code, 'unknown_resource');
  assert.equal(ev('allowed', { resource: 'reports' }).code, 'scope_not_for_backend');
  assert.equal(ev('scope-widening', { scope: 'orders:read' }).decision, 'allow', 'a narrower scope fixes it');
  assert.equal(ev('allowed', { scope: 'admin:all' }).code, 'scope_widening');
  assert.equal(ev('allowed', { scope: '' }).decision, 'allow');
  assert.throws(() => evaluateOboScenario(st, 'nope', {}, cast), (e) => e.code === 'unknown_scenario');
  for (const bad of [5, null, {}, '__proto__', 'constructor', undefined]) assert.throws(() => evaluateOboScenario(st, bad, {}, cast), (e) => e.code === 'unknown_scenario');
});

test('the hop panes hold the mock request and response, one traceparent per hop on one trace, and a valid incoming trace is continued', () => {
  const st = buildOboStory(cast);
  const out = evaluateOboScenario(st, 'allowed', {}, cast, `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
  assert.equal(out.traceId, 'a'.repeat(32));
  assert.equal(new Set(out.hops.map((h) => h.traceparent)).size, 3);
  for (const h of out.hops) assert.match(h.traceparent, /^00-a{32}-[0-9a-f]{16}-01$/);
  assert.match(out.hops[1].request, /grant_type=urn:ietf:params:oauth:grant-type:token-exchange/);
  assert.match(out.hops[1].request, /credentials never shown/);
  assert.match(out.hops[2].request, /Bearer <MOCK-ISSUED exchanged token>/);
  const denied = evaluateOboScenario(st, 'expired', {}, cast);
  assert.match(denied.hops[2].request, /not sent/);
  assert.notEqual(evaluateOboScenario(st, 'allowed', {}, cast, 'garbage').traceId, 'garbage');
});

test('the backend view is computed: the exchanged token is accepted, the original refused, and the log lines name who acted', () => {
  const st = buildOboStory(cast);
  const ok = evaluateOboScenario(st, 'chain', {}, cast);
  assert.equal(ok.backend.exchanged.accepted, true);
  assert.equal(ok.backend.original.accepted, false);
  assert.equal(ok.backend.differs, true);
  assert.match(ok.backend.logWithOnBehalfOf, /user=user-1001 actor=orders-agent > planner-agent/);
  assert.equal(evaluateOboScenario(st, 'expired', {}, cast).backend, null);
});

// ---------- HTTP ----------
test('POST /api/obo/evaluate: a scenario with and without overrides, strict fields, honest statuses, the workspace in the answer', async () => {
  await withServer(async (url) => {
    const post = (body, o) => call(url, 'POST', '/api/obo/evaluate', body, o);
    const ok = await post({ scenario: 'allowed' }, { ws: 'obo-a' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.result.decision, 'allow'); assert.equal(ok.json.workspace, 'obo-a');
    assert.match(ok.headers.get('traceparent'), /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    assert.equal((await post({ scenario: 'allowed', resource: 'reports' })).json.result.code, 'scope_not_for_backend');
    assert.equal((await post({ scenario: 'allowed', scope: 'orders:write' })).json.result.decision, 'allow');
    assert.equal((await post({ scenario: 'allowed', vertical: 'finance' })).json.request.resource.includes('fabrikam'), true);
    for (const [body, status, err] of [
      [{}, 400, 'unknown_scenario'], [{ scenario: 'nope' }, 400, 'unknown_scenario'], [{ scenario: 5 }, 400, 'unknown_scenario'],
      [{ scenario: 'allowed', extra: 1 }, 400, 'unknown_field'], [{ scenario: 'allowed', resource: 'x' }, 400, 'bad_resource'],
      [{ scenario: 'allowed', scope: 5 }, 400, 'bad_scope'], [{ scenario: 'allowed', scope: 'a b c d e f g h i j k' }, 400, 'bad_scope'], [[], 400, 'bad_request'], [null, 400, 'bad_request'],
    ]) { const r = await post(body); assert.equal(r.status, status, JSON.stringify(body)); assert.equal(r.json.error, err, JSON.stringify(body)); }
    assert.equal((await post(undefined, { raw: '{"scenario":"allowed","__proto__":{"x":1}}' })).json.error, 'unknown_field');
    assert.equal((await call(url, 'GET', '/api/obo/evaluate')).status, 404);
  });
});

test('GET /api/obo returns the story with every row tagged, no unfilled token, the banner and no live engine', async () => {
  await withServer(async (url) => {
    const j = (await call(url, 'GET', '/api/obo?vertical=health')).json;
    assert.match(j.banner, /^Ping release claim, UNVERIFIED on our tenant/);
    assert.match(j.noLive, /no Live engine/);
    assert.ok(!/\{\{/.test(JSON.stringify(j)));
    assert.equal(j.scenarios.length, 13);
    assert.ok(j.facts.every((f) => Object.hasOwn(j.tags, f.tag)));
    assert.equal(j.config.Resource.includes('contoso'), true);
    assert.equal(j.why.slide, 48);
    assert.ok(!('ClientSecret' in j.config) && !('PrivateKeyPEM' in j.config), 'write-only fields are never held');
    assert.equal((await call(url, 'GET', '/api/obo?vertical=__proto__')).json.config.Resource.includes('northwind'), true, 'unknown vertical keeps the default');
  });
});
