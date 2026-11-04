// Credential-shaped text typed into ANY field, query, path, header or unknown key of the release-update endpoints must be absent from every answer, from
// the state afterwards and from stdout/stderr. Masking is a heuristic (the page says so); these are the shapes the lab promises to catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeRounds, findCredentials, looksLikeCredential, maskKeepShape } from '../src/credentials.js';
import { maskDeep } from '../src/mask.js';
import { call, withServer } from './helpers.js';

import { N, SECRETS, needleOf } from './secrets.js';

test('the detectors catch every shape, after NFKC, deleting hidden characters and decoding percent-encoding three rounds', () => {
  for (const s of SECRETS) assert.ok(looksLikeCredential(s), s.slice(0, 40));
  assert.ok(!decodeRounds(`pass\uFFFDword=${N}`).includes('\uFFFD'));
  assert.equal(decodeRounds('%252570'), 'p');
  assert.equal(decodeRounds('%25252570'), '%70', 'only three rounds are decoded');
  assert.equal(decodeRounds('100%'), '100%', 'a stray percent stays');
  assert.equal(decodeRounds('%zz%41'), '%zzA');
  for (const s of SECRETS) { const m = maskKeepShape(s); assert.ok(!m.includes(N), `${s.slice(0, 30)} -> ${m.slice(0, 60)}`); }
});

test('typed text is never cut: an over-long value is refused whole (fixed text), so there is no half-masked remainder; and the masker itself keeps ordinary text byte for byte', async () => {
  assert.equal(maskKeepShape('  a  b\n'), '  a  b\n');
  await withServer(async (url) => {
    const pre = 'a '.repeat(197); // the secret would straddle any cut near 400
    const sc = await call(url, 'POST', '/api/obo/evaluate', { scenario: 'allowed', scope: `${pre}sk-${N}abcdef` }, { ws: 'cut' });
    assert.equal(sc.status, 400); assert.ok(!sc.text.includes('Zq9v'));
    const tl = await call(url, 'POST', '/api/three-lo/evaluate', { scenario: `${pre}sk-${N}abcdef` }, { ws: 'cut' });
    assert.equal(tl.status, 400); assert.equal(tl.json.error, 'unknown_scenario'); assert.ok(!tl.text.includes('Zq9v'));
    const cl = await call(url, 'POST', '/api/evaluate', { token: { a: `${'x'.repeat(520)}sk-${N}abcdef` }, rule: { requiredClaims: [{ path: 'a', equals: 'x' }] } }, { ws: 'cut' });
    assert.equal(cl.status, 400); assert.equal(cl.json.error, 'too_long'); assert.ok(!cl.text.includes('Zq9v'));
  });
});

test('ordinary words are left alone (over-masking would blank legitimate scope names and ids)', () => {
  for (const ok of ['bypass: open', 'orders:read orders:write', 'compass=north', 'northwind-gateway', 'role-lab-batch-job', 'tg-1', 'rt-1', 'https://gw.northwind.example', 'the secret is stored in the vault', 'token requirements', 'pinned endpoint', 'user-1001']) assert.equal(maskKeepShape(ok), ok, ok);
  assert.deepEqual(findCredentials('opensearch:read'), []);
});

test('maskDeep masks every string value, leaves signatures, traces and hop panes alone, and survives a 100000-deep structure', () => {
  const out = maskDeep({ a: `password=${N}`, b: [`ghp_${N}AbCdEfGhIjKl`, { c: `sk-${N}abcdefgh` }], signature: 'A'.repeat(60) + '=', request: 'Authorization: Bearer <MOCK-ISSUED>', n: 5, z: null });
  assert.ok(!JSON.stringify(out).includes(N));
  assert.equal(out.signature, 'A'.repeat(60) + '='); assert.equal(out.request, 'Authorization: Bearer <MOCK-ISSUED>'); assert.equal(out.n, 5);
  let deep = 'x'; for (let i = 0; i < 100000; i++) deep = { v: deep };
  assert.doesNotThrow(() => maskDeep(deep));
});

test('the detectors stay fast on hostile input (no catastrophic backtracking)', () => {
  const t0 = Date.now();
  for (const s of ['password'.repeat(2500), ' '.repeat(19000) + 'token ', '%25'.repeat(6000), 'a'.repeat(19999), '"password"'.repeat(1800), '\\"password\\"'.repeat(1500), '\\\\\\"'.repeat(3000) + 'password', 'Bearer ' + 'a'.repeat(19000), '-----BEGIN ' + 'PRIVATE KEY-----' + 'x'.repeat(19000), 'ghp_'.repeat(4000), '\u200b'.repeat(19000) + 'password=x', 'pass '.repeat(4000)]) maskKeepShape(s);
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
});

// Every place a visitor can put text.
const place = (url, ws, s) => {
  const enc = encodeURIComponent(s.slice(0, 300));
  return [
    ['POST', '/api/obo/evaluate', { scenario: s }], ['POST', '/api/obo/evaluate', { scenario: 'allowed', scope: s }], ['POST', '/api/obo/evaluate', { scenario: 'allowed', resource: s }], ['POST', '/api/obo/evaluate', { scenario: 'allowed', vertical: s }],
    ['POST', '/api/obo/evaluate', { scenario: 'allowed', [s]: 1 }], ['POST', '/api/obo/evaluate', { scenario: 'allowed', scope: { a: s } }],
    ['POST', '/api/three-lo/evaluate', { scenario: s }], ['POST', '/api/three-lo/evaluate', { scenario: 'allowed', extra: s }],
    ['GET', `/api/three-lo?vertical=${enc}`], ['GET', `/api/obo?vertical=${enc}`], ['GET', `/api/diagram?vertical=${enc}&name=${enc}`],
    ['GET', `/api/${enc}`], ['POST', `/api/${enc}`, {}], ['GET', `/api/three-lo/${enc}`], ['POST', `/api/obo/evaluate/${enc}`, {}], ['PUT', `/${enc}`, {}], ['DELETE', `/zzz/${enc}`, {}], ['POST', `/${enc}/x`, {}],
    ['POST', '/api/obo/evaluate', { scenario: 'allowed' }, { 'x-workspace': s }], ['POST', '/api/three-lo/evaluate', { scenario: 'allowed' }, { 'x-workspace': s }], ['GET', '/api/three-lo', undefined, { 'x-workspace': s }],
    ['POST', '/api/obo/evaluate', { scenario: 'allowed' }, { traceparent: s }], ['POST', '/api/three-lo/evaluate', { scenario: 'allowed' }, { traceparent: s }],
    ['POST', '/api/obo/evaluate', undefined, {}, `{"scenario":"allowed","scope":"${s.replace(/["\\\n]/g, '')}"`], // malformed JSON
  ].map(([m, p, body, headers, raw]) => ({ m, p, body, headers: headers || {}, raw }));
};

test('typed credential-shaped values never come back: every field, query, path, header and unknown key, every shape; and not in the state, the runs, stdout or stderr', async () => {
  const out = []; const err = [];
  const so = process.stdout.write.bind(process.stdout); const se = process.stderr.write.bind(process.stderr);
  await withServer(async (url) => {
    let hits = 0;
    process.stdout.write = (c, ...a) => { out.push(String(c)); return so(c, ...a); }; process.stderr.write = (c, ...a) => { err.push(String(c)); return se(c, ...a); };
    try {
      for (const s of SECRETS) {
        const needle = needleOf(s);
        for (const { m, p, body, headers, raw } of place(url, 'mask-w', s)) {
          let r;
          try { r = await call(url, m, p, body, { ws: headers['x-workspace'] ? undefined : 'mask-w', headers: Object.fromEntries(Object.entries(headers).filter(([, v]) => /^[\x20-\x7e]*$/.test(v) && v.length < 7000)), raw }); } catch { continue; } // a header the HTTP client itself refuses never reaches the server
          hits++;
          const all = `${r.status} ${[...r.headers].map(([k, v]) => `${k}: ${v}`).join('\n')} ${r.text}`;
          assert.ok(!all.includes(needle), `${m} ${p.slice(0, 50)} echoed a secret (${r.status}): ${needle.slice(0, 12)}`);
          assert.ok(!all.includes(decodeURIComponent(needle.replace(/%(?![0-9a-f]{2})/gi, '%25'))) || needle.length < 4);
          assert.ok(r.status !== 500, `${m} ${p.slice(0, 40)} gave 500`);
        }
      }
      assert.ok(hits > 600, `exercised ${hits} requests`);
    } finally { process.stdout.write = so; process.stderr.write = se; }
    // The state afterwards: the console views of every workspace used, the runs, and the walkthrough table.
    for (const ws of ['mask-w', 'default']) {
      const views = [await call(url, 'GET', '/api/three-lo', undefined, { ws }), await call(url, 'GET', '/api/runs', undefined, { ws }), await call(url, 'GET', '/api/obo', undefined, { ws })];
      for (const v of views) for (const s of SECRETS) assert.ok(!v.text.includes(needleOf(s)), `state holds a secret from ${s.slice(0, 20)}`);
    }
  });
  for (const s of SECRETS) { assert.ok(!out.join('').includes(needleOf(s))); assert.ok(!err.join('').includes(needleOf(s))); }
});

test('a credential typed as a scenario id or workspace field is REFUSED (not stored, not masked into state), with fixed text', async () => {
  await withServer(async (url) => {
    for (const s of SECRETS.slice(0, 12)) {
      const t = await call(url, 'POST', '/api/three-lo/evaluate', { scenario: s }, { ws: 'mask-r' });
      assert.equal(t.status, 400); assert.equal(t.json.error, 'unknown_scenario');
      const o = await call(url, 'POST', '/api/obo/evaluate', { scenario: 'allowed', scope: s }, { ws: 'mask-r' });
      assert.equal(o.status, 400); assert.ok(['credential_like', 'bad_scope'].includes(o.json.error));
    }
    const v = (await call(url, 'GET', '/api/runs', undefined, { ws: 'mask-r' })).json;
    assert.deepEqual(v.runs, []);
  });
});

test('credential-looking workspace ids are refused (400), good ones work, and the id is the only thing the answer repeats', async () => {
  await withServer(async (url) => {
    for (const ws of ['ghp-abcdefghij1234567890', 'a'.repeat(40), '0123456789abcdef0123456789abcdef01234567', 'sk-abcdefghijklmnop12', 'password-is-hunter22']) {
      for (const [m, p, b] of [['POST', '/api/three-lo/evaluate', { scenario: 'allowed' }], ['POST', '/api/obo/evaluate', { scenario: 'allowed' }], ['POST', '/api/evaluate', { scenario: 'allowed' }], ['GET', '/api/runs']]) {
        const r = await call(url, m, p, b, { ws }); assert.equal(r.status, 400, `${ws} ${p}`); assert.deepEqual(r.json, { error: 'bad_workspace' });
      }
    }
    assert.equal((await call(url, 'GET', '/api/runs', undefined, { ws: 'w-0123456789abcdef' })).status, 200, 'the page\'s own generated id is fine');
    assert.equal((await call(url, 'GET', '/api/runs', undefined, { ws: 'alice' })).json.workspace, 'alice');
  });
});

test('the lab\'s own fixed texts survive the response mask unchanged (over-masking would blank a lesson: a "token:" followed by a word looks like an assignment)', async () => {
  const { buildOboStory, evaluateOboScenario } = await import('../src/oboStory.js');
  const { buildThreeLoStory } = await import('../src/threeLoStory.js');
  const { evaluateThreeLoScenario } = await import('../src/threeLo.js');
  const { VERTICALS } = await import('../src/cast.js');
  for (const cast of Object.values(VERTICALS)) {
    const obo = buildOboStory(cast);
    const runs = obo.scenarios.map((s) => { const r = evaluateOboScenario(obo, s.id, {}, cast); return { ...r, hops: r.hops.map(({ request, response, ...h }) => h) }; });
    const lo = buildThreeLoStory(cast);
    const loRuns = lo.scenarios.map((s) => { const r = evaluateThreeLoScenario(lo, s.id); return { ...r, token: r.token ? { ...r.token, signature: r.token.signature } : null }; });
    for (const doc of [obo, lo, runs, loRuns]) assert.deepEqual(maskDeep(doc), doc);
  }
});
