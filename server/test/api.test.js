import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rawHttp, withServer, isolateSharedEnv } from './helpers.js';

isolateSharedEnv(); // the shared settings file may carry APD_REAL_ENGINE=1; these tests assert the mock default

test('GET /api/health answers demo-health/1, ready and offline', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/health`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.runtime, 'offline');
    assert.equal(j.demo.id, 'agentcore-pingone-demo-LAB');
    assert.deepEqual(Object.keys(j).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
  });
});

test('health is GET only', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/health`, { method: 'POST', headers: { origin: url } });
    assert.equal(r.status, 405);
  });
});

test('POST /api/reset confirms and refuses a cross-origin caller', async () => {
  await withServer(async (url) => {
    const ok = await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: '{}' });
    assert.equal((await ok.json()).reset, 'ok');
    const bad = await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    assert.equal(bad.status, 403);
  });
});

test('a non-loopback Host header is refused (DNS rebinding)', async () => {
  await withServer(async (url) => {
    const r = await rawHttp(`${url}/api/health`, { headers: { host: 'evil.example.invalid' } });
    assert.equal(r.status, 403);
  });
});

test('unknown API paths are 404 JSON', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/nope`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'not_found');
  });
});

test('GET /api/info is rule 19: source mock, realAvailable false with the how-to; POST /api/mode refuses real with 409 and accepts mock', async () => {
  await withServer(async (url) => {
    const post = (b) => fetch(`${url}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(b) });
    const j = await (await fetch(`${url}/api/info`)).json();
    assert.deepEqual(j, { source: 'mock', realAvailable: false, realReason: j.realReason, liveRefusal: j.liveRefusal, simulated: true });
    assert.match(j.realReason, /Real mode is not available/);
    const bad = await post({ source: 'real' });
    assert.equal(bad.status, 409);
    assert.match((await bad.json()).message, /Real mode is not available/);
    const ok = await post({ source: 'mock' });
    assert.equal(ok.status, 200); assert.equal((await ok.json()).source, 'mock');
    const malformed = await post({ source: 'other' });
    assert.equal(malformed.status, 400);
    const extra = await post({ source: 'mock', extra: 1 });
    assert.equal(extra.status, 400);
    const j2 = await (await fetch(`${url}/api/scenarios`)).json();
    assert.equal('hosted' in j2, false);
    assert.match(j2.banner, /^SIMULATED, MOCK mode/);
  });
});

test('an oversized or malformed body gets a short JSON error, never a stack trace or a file path', async () => {
  await withServer(async (url) => {
    const post = (body) => fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body });
    const big = await post(JSON.stringify({ pad: 'x'.repeat(9000) }));
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: 'payload_too_large' });
    const bad = await post('{not json');
    assert.equal(bad.status, 400);
    const text = JSON.stringify(await bad.json());
    assert.equal(text, JSON.stringify({ error: 'bad_request' }));
    assert.ok(!/\/Users\/|node_modules|at \w+ \(/.test(text), 'no stack or path');
    assert.equal((await fetch(`${url}/api/health`)).status, 200, 'the server stays up');
  });
});

test('GET /api/scenarios returns the filled story; customer.config.json is read on each request; verticals switch the cast', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apd-')), 'customer.config.json');
  await withServer(async (url) => {
    let j = await (await fetch(`${url}/api/scenarios`)).json();
    assert.equal(j.scenarios.length, 5);
    assert.ok(!/\{\{/.test(JSON.stringify(j)), 'no unfilled token');
    assert.equal(j.rule.requiredClaims[1].path, 'act.sub');
    assert.match(j.tokenLabel, /MOCK-ISSUED/);
    assert.ok(j.facts.some((f) => f.id === 'm2m-shape' && f.status === 'measured'));
    assert.equal(j.rule.requiredClaims[1].equals, 'orders-agent');
    j = await (await fetch(`${url}/api/scenarios?vertical=finance`)).json();
    assert.equal(j.rule.requiredClaims[1].equals, 'payments-agent');
    j = await (await fetch(`${url}/api/scenarios?vertical=__proto__`)).json();
    assert.equal(j.rule.requiredClaims[1].equals, 'orders-agent', 'unknown vertical keeps the default');
    fs.writeFileSync(file, JSON.stringify({ cast: { agentId: 'custom-agent' } }));
    j = await (await fetch(`${url}/api/scenarios`)).json();
    assert.equal(j.rule.requiredClaims[1].equals, 'custom-agent');
    assert.equal(j.scenarios[0].token.claims.act.sub, 'custom-agent');
  }, { configFile: file });
});

test('POST /api/evaluate gives each scenario its expected decision, with the reason', async () => {
  await withServer(async (url) => {
    const run = (body, headers = {}) => fetch(`${url}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: JSON.stringify(body) });
    const sc = (await (await fetch(`${url}/api/scenarios`)).json()).scenarios;
    for (const s of sc) {
      const j = await (await run({ scenario: s.id })).json();
      assert.equal(j.decision, s.expected, s.id);
      assert.equal(j.expected, s.expected);
    }
    const trap = await (await run({ scenario: 'act-text' })).json();
    assert.equal(trap.checks.find((c) => c.path === 'act.sub').reason, 'parent_not_object');
    assert.ok(trap.flat.some((f) => f.path === 'act' && f.value === '{}'));
    assert.equal((await run({ scenario: 'nope' })).status, 400);
    assert.equal((await run({ scenario: { toString: 1 } })).status, 400);
  });
});

test('POST /api/evaluate bounds hostile custom input and stays up', async () => {
  await withServer(async (url) => {
    const run = (text) => fetch(`${url}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: text });
    const rule = { requiredClaims: [{ path: 'act.sub', equals: 'x' }] };
    let deep = {}; let cur = deep;
    for (let i = 0; i < 1000; i++) { cur.a = {}; cur = cur.a; }
    const cases = [
      [{ token: deep, rule }, 'too_deep'],
      [{ token: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, 1])), rule }, 'too_many'],
      [{ token: { a: 'x'.repeat(600) }, rule }, 'too_long'],
      [{ token: { aud: Array.from({ length: 30 }, () => 'a') }, rule }, 'too_many'],
      [{ token: { 'act.sub': 'x' }, rule }, 'dotted_claim_name'],
      [{ token: [1], rule }, 'bad_token'],
      [{ token: 'abc', rule }, 'bad_token'],
      [{ token: {}, rule: { requiredClaims: [{ path: 'a..b', equals: 'x' }] } }, 'bad_rule'],
      [{ token: {}, rule: { requiredClaims: [{ path: '__proto__.x', equals: 'x' }] } }, null],
      [{ token: {}, rule: { requiredClaims: Array.from({ length: 9 }, () => ({ path: 'a', equals: 'x' })) } }, 'bad_rule'],
      [{ token: {}, rule: { requiredClaims: [{ path: 'a', equals: 5 }] } }, 'bad_rule'],
      [{ token: {} }, 'bad_rule'],
    ];
    for (const [body, code] of cases) {
      const r = await run(JSON.stringify(body));
      if (code) { assert.equal(r.status, 400, code); assert.equal((await r.json()).error, code); } else assert.equal(r.status, 200);
    }
    assert.equal((await run('[]')).status, 400);
    assert.equal((await run('null')).status, 400);
    const big = await run(JSON.stringify({ token: { pad: 'x'.repeat(9000) }, rule }));
    assert.equal(big.status, 413);
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
  });
});

test('evaluations are kept per workspace and Reset clears only that workspace', async () => {
  await withServer(async (url) => {
    const post = (p, ws, body = {}) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    await post('/api/evaluate', 'alice', { scenario: 'allowed' });
    await post('/api/evaluate', 'bob', { scenario: 'no-act' });
    const runs = async (ws) => (await (await fetch(`${url}/api/runs`, { headers: { 'x-workspace': ws } })).json()).runs;
    assert.deepEqual((await runs('alice')).map((r) => r.decision), ['allow']);
    await post('/api/reset', 'alice');
    assert.deepEqual(await runs('alice'), []);
    assert.deepEqual((await runs('bob')).map((r) => r.decision), ['deny']);
    assert.equal((await post('/api/evaluate', 'Bad Id!', { scenario: 'allowed' })).status, 400);
  });
});

test('GET /api/three-lo returns the USER_FEDERATION story with steps and scenarios', async () => {
  await withServer(async (url) => {
    const j = await (await fetch(`${url}/api/three-lo`)).json();
    assert.ok(j.simulated);
    assert.equal(j.scenarios.length, 7);
    assert.ok(j.steps.length >= 5);
    assert.ok(j.preRegistered.every((p) => p.sessionUri.endsWith('.example') || p.sessionUri.includes('.example')));
    assert.ok(!/\{\{/.test(JSON.stringify(j)), 'no unfilled token');
  });
});

test('GET /api/diagram serves the m2m-gate diagram-studio data, uncached; by name serves the others', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/diagram`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.equal(j.steps.length, 6);
    assert.ok(j.nodes.some((n) => n.label.includes('AgentCore Identity')));
    assert.ok(j.steps[2].say.includes('orders-agent'));
    const lo = await (await fetch(`${url}/api/diagram?name=three-lo`)).json();
    assert.ok(lo.nodes.some((n) => n.label.includes('PingOne')));
    const obo = await (await fetch(`${url}/api/diagram?name=obo`)).json();
    assert.ok(obo.nodes.length > 0);
  });
});

test('the 3LO callback is prefix-tolerant: /agentcore-pingone/api/real/callback reaches the API, not the SPA', async () => {
  await withServer(async (url) => {
    // unknown session through the PREFIXED path: must be the API's JSON/502 answer, never index.html
    const r = await fetch(`${url}/agentcore-pingone/api/real/callback?session_id=urn:fake`);
    const text = await r.text();
    assert.equal(r.status, 502);
    assert.match(text, /Real 3LO failed/);
    assert.equal(text.includes('<!doctype html'), false, 'the SPA must not answer a prefixed callback');
    // a path with a totally different mount prefix behaves the same
    const r2 = await fetch(`${url}/some/other/prefix/api/real/callback?session_id=urn:fake`);
    assert.equal(r2.status, 502);
  });
});

test('GET /api/shelf is reachable without a web build and reads SHELF_URL; POST is refused', async () => {
  const prev = process.env.SHELF_URL;
  process.env.SHELF_URL = 'https://shelf.example:8443/';
  try {
    await withServer(async (url) => {
      const r = await fetch(`${url}/api/shelf`);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { shelfUrl: 'https://shelf.example:8443' });
      assert.notEqual((await fetch(`${url}/api/shelf`, { method: 'POST', headers: { origin: url } })).status, 200);
    });
  } finally {
    if (prev === undefined) delete process.env.SHELF_URL; else process.env.SHELF_URL = prev;
  }
});
