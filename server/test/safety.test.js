import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, assertBindAllowed, bindHost, portProblem, resolvePort, isReservedHost, scanHosts, scanKeys, cleanText, hostCheck, sameOriginWrites } from '../src/safety.js';

test('loopback names', () => {
  for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]']) assert.ok(isLoopbackHost(h), h);
  for (const h of ['0.0.0.0', '192.168.1.5', 'example.com', 'localhost.evil.invalid']) assert.ok(!isLoopbackHost(h), h);
});

test('bind: loopback only unless APD_BIND is set', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('127.0.0.1', {}), '127.0.0.1');
  assert.equal(assertBindAllowed('0.0.0.0', { APD_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('ports: 7601-7649 only, never a reserved or another agent\'s one', () => {
  assert.equal(portProblem(7601), null); assert.equal(portProblem(7609), null);
  for (const p of [5000, 5200, 5149, 5200, 8080, 5173, 3900, 4000, 4400, 4510, 4600, 4601, 4840, 18080, 19080, 19090, 4771, 4700]) assert.ok(portProblem(p), String(p));
  assert.ok(portProblem(NaN));
  assert.equal(resolvePort({}), 7601);
  assert.equal(resolvePort({ PORT: '7605' }), 7605);
  assert.throws(() => resolvePort({ PORT: '5010' }));
  assert.throws(() => resolvePort({ PORT: '5200' }));
});

test('reserved hosts and the host scan', () => {
  assert.ok(isReservedHost('a.b.invalid')); assert.ok(isReservedHost('mcp.northwind.example')); assert.ok(!isReservedHost('example.com'), 'the rulebook allows only .example and .invalid'); assert.ok(!isReservedHost('example.org')); assert.ok(!isReservedHost('sub.example.com'));
  assert.deepEqual(scanHosts('https://as.example.invalid/x and mail a@agent.example and http://localhost:7601/'), []);
  assert.deepEqual(scanHosts('https://example.com/mcp'), ['example.com']);
  assert.deepEqual(scanHosts('see https://real.com/x and 10.1.2.3'), ['10.1.2.3', 'real.com']);
});

test('key scan: only sk-MOCK- values are allowed in shipped text', () => {
  assert.deepEqual(scanKeys('sk-MOCK-ABCDEF and sk-MOCK-REAL-UPSTREAM-PLACEHOLDER'), []);
  assert.equal(scanKeys('key sk-proj-abcdefghijklmnop1234').length, 1);
  assert.equal(scanKeys('sk-ant-api03-abcdefghijkl').length, 1);
});

test('cleanText strips control and bidi characters and caps the length', () => {
  assert.equal(cleanText('a\u0000b\nc‮d', 80), 'a b c d');
  assert.equal(cleanText('x'.repeat(100), 10).length, 10);
  assert.equal(cleanText(undefined), '');
});

const run = (mw, req) => { const out = {}; const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } }; mw(req, res, () => { out.next = true; }); return out; };

test('hostCheck refuses a non-loopback Host (DNS rebinding)', () => {
  assert.ok(run(hostCheck, { headers: { host: 'localhost:7601' } }).next);
  assert.ok(run(hostCheck, { headers: { host: '[::1]:7601' } }).next);
  assert.equal(run(hostCheck, { headers: { host: 'evil.example.invalid:7601' } }).status, 403);
  assert.equal(run(hostCheck, { headers: {} }).status, 403);
});

test('sameOriginWrites: GET passes, cross-origin and cross-site writes refused', () => {
  const h = { host: 'localhost:7601' };
  assert.ok(run(sameOriginWrites, { method: 'GET', headers: { ...h, origin: 'http://evil.example.invalid' } }).next);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: h }).next, 'no Origin (curl) is allowed');
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:7601' } }).next);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:9999' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'null' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'DELETE', headers: { ...h, 'sec-fetch-site': 'cross-site' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'PUT', headers: { ...h, 'sec-fetch-site': 'same-site' } }).status, 403);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, 'sec-fetch-site': 'same-origin' } }).next);
});

test('a write is same-origin only: the Host header decides, and no environment variable adds a public host', () => {
  const loopback = { host: '127.0.0.1:7601' };
  const post = (origin) => run(sameOriginWrites, { method: 'POST', headers: { ...loopback, origin } });
  const saved = process.env.APD_PUBLIC_HOST;
  try {
    process.env.APD_PUBLIC_HOST = 'app.demo.example';
    assert.equal(post('https://app.demo.example').status, 403, 'a public origin is refused even when a variable names it');
    assert.ok(post('http://127.0.0.1:7601').next, 'the page\'s own origin is accepted');
    assert.equal(post('https://evil.example').status, 403);
    assert.equal(post('not a url').status, 403, 'a malformed origin is refused');
  } finally {
    if (saved === undefined) delete process.env.APD_PUBLIC_HOST; else process.env.APD_PUBLIC_HOST = saved;
  }
});

test('review fixes: octets above 255 are not loopback; 4840 is reserved; control and bidi characters are stripped', async () => {
  assert.equal(isLoopbackHost('127.999.999.999'), false);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('127.255.255.255'), true);
  assert.ok(portProblem(4840));
  const { loadCast } = await import('../src/cast.js');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pad-')), 'customer.config.json');
  fs.writeFileSync(f, JSON.stringify({ cast: { brand: 'Acme\u202eevil' } }));
  assert.ok(!/\u202e/.test(loadCast(f).castBrand));
});
