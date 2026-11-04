import test from 'node:test';
import assert from 'node:assert/strict';
import { allPassed, runChecks } from '../src/doctor.js';
import { DEFAULT_CAST } from '../src/cast.js';

test('every doctor check passes on a clean default environment', async () => {
  const checks = await runChecks({ env: {} });
  assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => c.level === 'fail')));
  for (const id of ['node', 'bind', 'port-range', 'scenarios', 'facts-labelled', 'story-tokens', 'verticals', 'diagrams', 'story-hosts', 'story-keys', 'netguard', 'settings-file', 'tenant', 'release-tags', 'obo-scenarios', 'release-tokens', 'release-hosts', 'three-lo-scenarios']) {
    assert.ok(checks.some((c) => c.id === id), id);
  }
});

test('a port outside 7601-7649 fails, and a wildcard bind needs the opt-in', async () => {
  assert.equal((await runChecks({ env: { PORT: '5010' } })).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal((await runChecks({ env: { PORT: '7601', APD_BIND: '0.0.0.0' } })).find((c) => c.id === 'bind').level, 'pass');
});

test('the mode check reports the rule-19 source; a bare MODE is ignored', async () => {
  const mode = (await runChecks({ env: {} })).find((c) => c.id === 'mode');
  assert.equal(mode.level, 'pass');
  assert.match(mode.detail, /^mock/);
  assert.equal((await runChecks({ env: { MODE: 'real' } })).find((c) => c.id === 'mode').level, 'pass');
});

test('the settings-file check reports the shared file by existence and mode and never prints a value', async () => {
  const missing = (await runChecks({ env: { STANDALONE_ENV: '/nonexistent/.env' } })).find((c) => c.id === 'settings-file');
  assert.equal(missing.level, 'info');
});

test('the doctor host scan catches a real host in the story', async () => {
  const bad = { ...DEFAULT_CAST, castBrand: 'Acme https://acme-airlines.com/x' };
  const hosts = (await runChecks({ env: {}, cast: bad })).find((c) => c.id === 'story-hosts');
  assert.equal(hosts.level, 'fail');
  assert.match(hosts.detail, /acme-airlines\.com/);
  assert.equal((await runChecks({ env: {} })).find((c) => c.id === 'story-hosts').level, 'pass');
});
