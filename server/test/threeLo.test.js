import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThreeLoStory } from '../src/threeLoStory.js';
import { evaluateThreeLoScenario, CHECKS, stepIndex } from '../src/threeLo.js';
import { DEFAULT_CAST, VERTICALS } from '../src/cast.js';

const story = (cast = DEFAULT_CAST) => buildThreeLoStory(cast);

test('every check can be the failing check of some scenario, and every scenario names an existing check', () => {
  const st = story();
  const named = new Set(st.scenarios.map((s) => s.breakAt).filter(Boolean));
  for (const id of named) assert.ok(CHECKS.some((c) => c.id === id), `scenario breakAt ${id} is not a check`);
  const failing = new Set(st.scenarios.map((s) => evaluateThreeLoScenario(st, s.id).failedCheck).filter(Boolean));
  for (const c of CHECKS) assert.ok(failing.has(c.id) || c.id === 'token-auth-method' || c.id === 'session-preregistered' || c.id === 'callback-match', `check ${c.id} is never exercised`);
  // the three mid-flow checks ARE exercised (callback-match, session-preregistered, token-auth-method via their scenarios)
  for (const need of ['iam-get-token', 'callback-match', 'session-preregistered', 'token-auth-method', 'code-fresh', 'per-invocation-user']) {
    assert.ok(st.scenarios.some((s) => s.breakAt === need), `no scenario breaks at ${need}`);
  }
});

test('each denied scenario fails exactly the check its breakAt names, and the steps after it are not reached', () => {
  for (const cast of Object.values(VERTICALS)) {
    const st = story(cast);
    for (const sc of st.scenarios) {
      const r = evaluateThreeLoScenario(st, sc.id);
      assert.equal(r.decision, sc.expected, `${sc.id} (${cast.castHost}) decision`);
      assert.equal(r.code, sc.code, `${sc.id} (${cast.castHost}) code`);
      const idx = stepIndex(sc.breakAt);
      if (idx === -1) { assert.equal(r.failedCheck, null, `${sc.id} failedCheck`); continue; }
      assert.equal(r.failedCheck, sc.breakAt, `${sc.id} (${cast.castHost}) failing check`);
      assert.equal(r.checks[idx].ok, false, `${sc.id} the named check is the one that failed`);
      assert.ok(r.checks.slice(0, idx).every((c) => c.ok === true), `${sc.id} everything before passed`);
      assert.ok(r.checks.slice(idx + 1).every((c) => c.ok === null), `${sc.id} everything after is not reached`);
    }
  }
});

test('the no-user-context scenario is honest: a token is minted and its sub is the deploy-time user, never the caller', () => {
  const st = story();
  const sc = st.scenarios.find((s) => s.id === 'no-user-context');
  const r = evaluateThreeLoScenario(st, sc.id);
  assert.equal(r.decision, 'deny');
  assert.equal(r.failedCheck, 'per-invocation-user');
  assert.ok(r.token, 'the exchange itself succeeded, so a token exists');
  assert.equal(r.token.claims.sub, 'deploy-user');
  assert.match(sc.lesson, /per invocation|deploy time/i);
  assert.equal(r.user, null, 'no human is named: that is the trap');
});

test('the allowed scenario mints a token whose sub is the human, and every check passed', () => {
  const st = story();
  const r = evaluateThreeLoScenario(st, st.scenarios[0].id);
  assert.equal(r.decision, 'allow');
  assert.equal(r.failedCheck, null);
  assert.ok(r.checks.every((c) => c.ok === true));
  assert.equal(r.token.claims.sub, 'user-1001');
  assert.equal(r.user.sub, 'user-1001');
});
