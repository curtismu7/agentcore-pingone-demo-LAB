// Fixed JSON errors for every method and path, strict bodies, bounded sizes, and the things a hostile caller tries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, rawHttp, withServer } from './helpers.js';

test('an unknown path is a fixed JSON 404 for every method, under /api or not, and echoes nothing', async () => {
  await withServer(async (url) => {
    // A GET outside /api serves the page (single-page app) when web/dist is built, so only writes are checked there.
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) for (const p of ['/nope', '/a/b/c', '/api/nope', '/api/agentcore-console/nope', '/api/three-lo/nope', '/api/obo/nope', '/zzz%2e%2e/x']) {
      if (m === 'GET' && !p.startsWith('/api/')) continue;
      const r = await call(url, m, p, m === 'GET' ? undefined : {});
      assert.equal(r.status, 404, `${m} ${p}`); assert.deepEqual(r.json, { error: 'not_found' }, `${m} ${p}`);
      assert.ok(!/Cannot|<html|<pre/i.test(r.text));
    }
  });
});

test('bodies: wrong shapes, __proto__ and constructor keys at any level, deep nesting and oversize all get a short JSON answer and the server stays up', async () => {
  await withServer(async (url) => {
    const post = (p, raw) => call(url, 'POST', p, undefined, { raw });
    let deep = '"x"'; for (let i = 0; i < 1000; i++) deep = `{"a":${deep}}`;
    for (const p of ['/api/obo/evaluate', '/api/three-lo/evaluate']) {
      for (const raw of ['[]', 'null', '"x"', '5', 'true', '{"__proto__":{"a":1}}', '{"constructor":{"prototype":{"a":1}}}', '{"kind":{"__proto__":1}}', '{"scenario":{"__proto__":1}}', deep, '{"kind":"set-waf","mode":"fail-closed","prototype":1}']) {
        const r = await post(p, raw); assert.ok([400, 404].includes(r.status), `${p} ${raw.slice(0, 30)} -> ${r.status}`); assert.ok(r.json?.error, raw.slice(0, 30));
      }
      const big = await post(p, JSON.stringify({ pad: 'x'.repeat(9000) })); assert.equal(big.status, 413); assert.deepEqual(big.json, { error: 'payload_too_large' });
      const bad = await post(p, '{not json'); assert.equal(bad.status, 400); assert.deepEqual(bad.json, { error: 'bad_request' });
    }
    assert.equal(Object.prototype.a, undefined, 'the prototype was not polluted');
    assert.equal(({}).a, undefined);
    assert.equal((await call(url, 'GET', '/api/health')).status, 200);
  });
});

test('the same-origin and Host rules cover the new writes', async () => {
  await withServer(async (url) => {
    for (const p of ['/api/obo/evaluate', '/api/three-lo/evaluate']) {
      const x = await call(url, 'POST', p, { scenario: 'allowed' }, { headers: { origin: 'https://evil.example' } });
      assert.equal(x.status, 403); assert.equal(x.json.error, 'cross_origin');
      assert.equal((await call(url, 'POST', p, {}, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
      const h = await rawHttp(`${url}${p}`, { method: 'POST', headers: { host: 'evil.example.invalid', 'content-type': 'application/json' }, body: '{}' });
      assert.equal(h.status, 403);
    }
    const h = await rawHttp(`${url}/api/three-lo`, { headers: { host: 'evil.example.invalid' } });
    assert.equal(h.status, 403);
  });
});

test('new answers are uncached and the new reads work with no workspace header (the default workspace)', async () => {
  await withServer(async (url) => {
    for (const p of ['/api/obo', '/api/three-lo']) {
      const r = await fetch(`${url}${p}`);
      assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      const j = await r.json(); assert.equal(j.simulated, true); assert.equal('hosted' in j, false);
    }
  });
});

test('an expired or very large run of requests does not leak: 300 mixed requests, no 500', async () => {
  await withServer(async (url) => {
    const bodies = [['/api/obo/evaluate', { scenario: 'allowed' }], ['/api/obo/evaluate', { scenario: 'replay' }], ['/api/agentcore-console/act', { kind: 'set-target', target: 'tg-3', enabled: false }], ['/api/agentcore-console/probe', { kind: 'waf-outage' }], ['/api/agentcore-console/act', { kind: 'zz' }]];
    // Waves of 20 parallel requests: still concurrent on one workspace, but a loaded machine cannot hit the client's 10 s connect timeout.
    const rs = [];
    for (let w = 0; w < 15; w++) rs.push(...await Promise.all(Array.from({ length: 20 }, (_, j) => { const i = w * 20 + j; return call(url, 'POST', bodies[i % 5][0], bodies[i % 5][1], { ws: `mix-${i % 7}` }); })));
    assert.equal(rs.length, 300);
    assert.ok(rs.every((r) => r.status < 500));
  });
});
