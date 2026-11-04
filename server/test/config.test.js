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

test('Real is only available when the owner opts in (APD_REAL_ENGINE=1 and the PingOne worker settings), and a bare MODE is never read', () => {
  assert.equal(realConfigured({}), false);
  assert.equal(realConfigured({ APD_REAL_ENGINE: '1' }), false, 'the engine flag alone is not enough');
  assert.equal(realConfigured({ APD_REAL_ENGINE: '1', PINGONE_ENVIRONMENT_ID: 'e', PINGONE_WORKER_CLIENT_ID: 'c' }), true);
  assert.equal(createMode({ env: { MODE: 'real' } }).source(), 'mock', 'a bare MODE must not switch this app');
  assert.deepEqual(MODES, ['mock', 'real']);
});
