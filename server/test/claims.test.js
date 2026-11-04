import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsInputError, LIMITS, evaluateClaims, flattenClaims } from '../src/claims.js';
import { findCredentials } from '../src/credentials.js';

const rule = { requiredClaims: [{ path: 'client_id', equals: 'a1' }, { path: 'act.sub', equals: 'a1' }] };
const ok = { client_id: 'a1', act: { sub: 'a1' } };

test('flattenClaims makes dotted paths, indexes arrays and sorts', () => {
  const flat = flattenClaims({ b: 1, act: { sub: 'x', deep: { n: true } }, aud: ['p', 'q'], none: null });
  assert.deepEqual([...flat], [['act.deep.n', true], ['act.sub', 'x'], ['aud.0', 'p'], ['aud.1', 'q'], ['b', 1], ['none', null]]);
});

test('nested match: allow only when every required claim equals', () => {
  assert.equal(evaluateClaims(ok, rule).decision, 'allow');
  assert.equal(evaluateClaims({ ...ok, act: { sub: 'z' } }, rule).decision, 'deny');
  assert.equal(evaluateClaims({ client_id: 'a1' }, rule).checks[1].reason, 'missing');
  assert.equal(evaluateClaims({ ...ok, client_id: 'z' }, rule).checks[0].reason, 'mismatch');
});

test('the "{}" text trap: act as a string is not an object, so act.sub does not exist', () => {
  const r = evaluateClaims({ client_id: 'a1', act: '{}' }, rule);
  assert.equal(r.decision, 'deny');
  assert.equal(r.checks[1].reason, 'parent_not_object');
  assert.match(r.checks[1].detail, /not an object/);
});

test('a non-string value never equals the required text (no loose coercion)', () => {
  const r = evaluateClaims({ client_id: 'a1', act: { sub: 1 } }, { requiredClaims: [{ path: 'act.sub', equals: '1' }] });
  assert.equal(r.decision, 'deny');
  assert.equal(r.checks[0].reason, 'type_mismatch');
});

test('a flat key containing a dot cannot fake a nested claim (refused, never silently resolved)', () => {
  const refused = (t) => assert.throws(() => evaluateClaims(t, rule), (e) => e instanceof ClaimsInputError && e.code === 'dotted_claim_name');
  refused({ client_id: 'a1', 'act.sub': 'a1' });                          // repro 1: would have ALLOWed
  refused({ client_id: 'a1', act: { sub: 'good' }, 'act.sub': 'evil' });   // repro 2: would have resolved to the wrong value
  refused({ client_id: 'a1', act: { 'x.y': 'a1' } });                     // nested dotted name too
});

test('equals is an exact match: a longer or shorter value is a near miss, not a prefix match', () => {
  for (const actual of ['a1-evil', 'a1x', 'a', 'A1', ' a1', 'a1 ']) {
    const r = evaluateClaims({ client_id: actual, act: { sub: 'a1' } }, rule);
    assert.equal(r.decision, 'deny', actual);
    assert.equal(r.checks[0].reason, 'mismatch');
  }
  const rev = evaluateClaims({ client_id: 'a1', act: { sub: 'a1' } }, { requiredClaims: [{ path: 'client_id', equals: 'a1-evil' }] });
  assert.equal(rev.decision, 'deny');
});

test('the claim-name length limit is exactly 64', () => {
  assert.doesNotThrow(() => flattenClaims({ ['k'.repeat(LIMITS.name)]: 1 }));
  assert.throws(() => flattenClaims({ ['k'.repeat(LIMITS.name + 1)]: 1 }), (e) => e.code === 'too_long' && /claim name/.test(e.message));
  assert.equal(LIMITS.name, 64);
});

test('hostile input: __proto__ keys, depth, count, length and shape are bounded', () => {
  const polluted = JSON.parse('{"__proto__": {"sub": "a1"}, "client_id": "a1"}');
  assert.equal(evaluateClaims(polluted, rule).decision, 'deny');
  assert.equal({}.sub, undefined, 'Object.prototype untouched');
  let deep = {}; let cur = deep;
  for (let i = 0; i < 100_000; i++) { cur.a = {}; cur = cur.a; }
  assert.throws(() => flattenClaims(deep), (e) => e instanceof ClaimsInputError && e.code === 'too_deep');
  // the API-facing bound is exactly LIMITS.depth: one less is accepted, one more is refused
  assert.equal(flattenClaims(Object.fromEntries(Array.from({ length: LIMITS.depth - 1 }, (_, i) => [`k${i}`, { n: 1 }]))).size, LIMITS.depth - 1);
  const atLimit = {}; let c2 = atLimit;
  for (let i = 0; i < LIMITS.depth; i++) { c2.a = {}; c2 = c2.a; }
  assert.throws(() => flattenClaims(atLimit), (e) => e.code === 'too_deep');
  assert.throws(() => flattenClaims({ a: 'x'.repeat(LIMITS.string + 1) }), /longer/);
  assert.throws(() => flattenClaims(Object.fromEntries(Array.from({ length: LIMITS.keys + 1 }, (_, i) => [`k${i}`, 1]))), /more than/);
  for (const bad of [null, [], 'x', 5, undefined]) assert.throws(() => flattenClaims(bad), (e) => e.code === 'bad_token');
  for (const bad of [null, {}, { requiredClaims: [] }, { requiredClaims: [{ path: 'a b', equals: 'x' }] }, { requiredClaims: [{ path: '1a', equals: 'x' }] }, { requiredClaims: [{ path: 'a', equals: '' }] }]) {
    assert.throws(() => evaluateClaims({}, bad), (e) => e.code === 'bad_rule');
  }
});

test('evaluateClaims is pure: it does not change its inputs', () => {
  const t = structuredClone(ok); const r = structuredClone(rule);
  evaluateClaims(t, r);
  assert.deepEqual(t, ok); assert.deepEqual(r, rule);
});

test('the pure engine masks a typed credential before it is quoted in a message (so quoting cannot hide it), and no message names a claim key', async () => {
  const { N } = await import('./secrets.js');
  const flatTrap = evaluateClaims({ act: `{"password":"${N}"}` }, { requiredClaims: [{ path: 'act.sub', equals: 'x' }] });
  assert.ok(!flatTrap.checks[0].detail.includes(N), flatTrap.checks[0].detail);
  const mismatch = evaluateClaims({ a: `password=${N}` }, { requiredClaims: [{ path: 'a', equals: 'x' }] });
  assert.ok(!mismatch.checks[0].detail.includes(N), mismatch.checks[0].detail);
  assert.throws(() => flattenClaims({ secretish: 'x'.repeat(LIMITS.string + 1) }), (e) => e.code === 'too_long' && !/secretish/.test(e.message));
  assert.throws(() => flattenClaims({ [`k${'x'.repeat(LIMITS.name)}`]: 1 }), (e) => !e.message.includes('kxxx'));
  assert.ok(findCredentials(`{\\"password\\":\\"${N}\\"}`).length > 0, 'a backslash-escaped JSON key is found');
});
