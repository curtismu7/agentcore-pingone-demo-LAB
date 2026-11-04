import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETTINGS_KEYS, applySharedSettings, readSharedSettings } from '../src/settings.js';

const withFile = (text, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcl-set-'));
  const f = path.join(dir, '.env'); fs.writeFileSync(f, text, { mode: 0o600 });
  try { return fn(f); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('only this app\'s own key is taken from the shared settings file; every other key stays out', () => {
  assert.deepEqual(SETTINGS_KEYS, ['APD_MODE']);
  withFile('SOME_OTHER_APP_SECRET=not-a-real-value\nMODE=live\nPORT=9999\nAPD_MODE=mock\n# a comment\nOTHER_APP_TOKEN="x y"\n', (f) => {
    assert.deepEqual(readSharedSettings(f), { APD_MODE: 'mock' });
    const env = { HOME: '/x' };
    applySharedSettings(env, f);
    assert.deepEqual(Object.keys(env).sort(), ['APD_MODE', 'HOME']);
    assert.equal(env.APD_MODE, 'mock');
  });
});

test('the environment wins over the file; a missing, empty or unreadable file is the defaults', () => {
  withFile('APD_MODE=live\n', (f) => assert.equal(applySharedSettings({ APD_MODE: 'mock' }, f).APD_MODE, 'mock'));
  assert.deepEqual(readSharedSettings('/nonexistent/.env'), {});
  withFile('', (f) => assert.deepEqual(readSharedSettings(f), {}));
  withFile('APD_MODE=\n', (f) => assert.deepEqual(readSharedSettings(f), {}));
  assert.deepEqual(readSharedSettings(os.tmpdir()), {}, 'a directory is not a settings file');
});

test('there is no per-app .env loader: the server never calls loadEnvFile', () => {
  for (const f of ['src/index.js', 'src/app.js', '../scripts/doctor.mjs']) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /loadEnvFile/, f);
  }
});
