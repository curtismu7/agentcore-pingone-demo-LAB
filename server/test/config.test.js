import test from 'node:test';
import assert from 'node:assert/strict';
import { createMode, MODES } from '../src/mode.js';
import { realConfigured } from '../src/real.js';

test('the mode defaults to mock while Real is unconfigured; the source switches at runtime', () => {
  const m = createMode({ env: {} });
  assert.equal(m.source(), 'mock');
  assert.equal(m.info().realAvailable, false);
  assert.match(m.info().realReason, /Real mode is not available/);
  m.set('real'); // the route guards this; the state itself allows the switch
  assert.equal(m.source(), 'real');
  m.set('mock');
  assert.equal(m.source(), 'mock');
});

test('Real is only available when the owner opts in (APD_REAL_ENGINE=1 plus AWS creds, workload name, provider name and return URL), and a bare MODE is never read', () => {
  // isolate from the shared settings file: the owner's ~/Development/.env may legitimately carry the real settings.
  // loadSharedEnv reads process.env.STANDALONE_ENV, so point it at a nonexistent file for the duration of this test.
  const savedShared = process.env.STANDALONE_ENV;
  process.env.STANDALONE_ENV = '/tmp/apd-empty-env/empty.env'; // exists but empty: no fallthrough to the shared file
  try {
    assert.equal(realConfigured({}), false);
    assert.equal(realConfigured({ APD_REAL_ENGINE: '1' }), false, 'the engine flag alone is not enough');
    assert.equal(realConfigured({ APD_REAL_ENGINE: '1', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's', AWS_REGION: 'us-east-1' }), false, 'creds alone are not enough');
    assert.equal(realConfigured({ APD_REAL_ENGINE: '1', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's', AWS_REGION: 'us-east-1', APD_REAL_WORKLOAD_NAME: 'w' }), false, 'the provider name is still missing');
    assert.equal(realConfigured({ APD_REAL_ENGINE: '1', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's', AWS_REGION: 'us-east-1', APD_REAL_WORKLOAD_NAME: 'w', APD_REAL_PROVIDER_NAME: 'p', APD_REAL_RETURN_URL: 'https://x/' }), true);
    assert.equal(createMode({ env: { MODE: 'real' } }).source(), 'mock', 'a bare MODE must not switch this app');
  } finally {
    if (savedShared === undefined) delete process.env.STANDALONE_ENV; else process.env.STANDALONE_ENV = savedShared;
  }
  assert.deepEqual(MODES, ['mock', 'real']);
});
