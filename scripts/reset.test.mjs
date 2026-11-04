import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, startHttpServer } from '../server/src/app.js';
import { createHealth } from '../server/src/health.js';
import { createWorkspaces } from '../server/src/workspaces.js';
import { reset } from './reset.mjs';

test('the reset script clears the default workspace (its runs), leaves another workspace alone, and refuses a non-loopback host', async () => {
  const workspaces = createWorkspaces();
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, workspaces }) });
  try {
    const base = url.replace(/\/$/, '');
    workspaces.record('default', { scenario: 'allowed', decision: 'allow' }); workspaces.record('other', { scenario: 'allowed', decision: 'allow' });
    assert.deepEqual(await reset(base), { reset: 'ok', workspace: 'default' });
    assert.equal(workspaces.runs('default').runs.length, 0);
    assert.equal(workspaces.runs('other').runs.length, 1, 'another workspace is untouched');
    await assert.rejects(reset('http://example.invalid:7601'), /loopback only/);
  } finally { health.stop(); await new Promise((r) => server.close(r)); }
});
