import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the files the standalone rules ask for are present, and the old SE/k8s and per-app .env files are gone', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.dockerignore', '.github/workflows/ci.yml', 'docs/talk-track.md', 'docs/safety.md', 'docs/shelf-entry.json', 'docs/content-pack.schema.json', 'customer.config.example.json', 'content-pack.json', 'scripts/doctor.mjs', 'scripts/reset.mjs', 'scripts/run.sh', 'web/src/styles/standalone-ui.css', 'server/diagrams/m2m-gate.json', 'server/src/settings.js']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
  for (const f of ['k8s', 'scripts/k8s.test.mjs', '.env.example', 'web/src/tokens.css', 'web/src/components/diagram']) assert.ok(!fs.existsSync(path.join(root, f)), `${f} must not exist`);
});

test('the shelf entry is valid and portable: relative composeFile, loopback url, health path, catalog id D114, no hosted fields', () => {
  const e = JSON.parse(read('docs/shelf-entry.json')).demos[0];
  assert.equal(e.id, 'agentcore-pingone-demo-lab');
  assert.ok(e.description.length > 0 && e.description.length <= 300, 'the shelf refuses to start on a description over 300 characters');
  assert.equal(e.kind, 'Demo');
  assert.equal(e.healthPath, '/api/health');
  assert.match(e.url, /^http:\/\/localhost:76\d\d$/);
  assert.equal(e.catalogId, 'D114', 'catalog id D114 is a placeholder until the owner confirms it');
  assert.equal(e.composeFile, 'agentcore-pingone-demo-LAB/docker-compose.yml');
  assert.ok(!path.isAbsolute(e.composeFile), 'composeFile must be relative or a placeholder');
  assert.ok(!('mockUrl' in e) && !('where' in e), 'the hosted SE fields are gone');
  assert.ok(!/\/Users\//.test(JSON.stringify(e)), 'no absolute home path');
});

test('the content pack carries the same catalog id as the shelf entry', () => {
  const pack = JSON.parse(read('content-pack.json'));
  assert.equal(pack.demo.catalog, JSON.parse(read('docs/shelf-entry.json')).demos[0].catalogId);
});

test('customer.config.json is git-ignored, and its example only sets the four cast values', () => {
  assert.match(read('.gitignore'), /^customer\.config\.json$/m);
  assert.deepEqual(Object.keys(JSON.parse(read('customer.config.example.json')).cast).sort(), ['agentId', 'brand', 'clientId', 'host']);
});

test('no shipped text names a real customer, company or tenant', () => {
  const skip = new Set(['node_modules', 'dist', '.git', 'package-lock.json']);
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (!['repo.test.mjs', 'story.test.js', 'content-pack.test.mjs'].some((n) => p.endsWith(n))) {
        const t = fs.readFileSync(p, 'utf8').toLowerCase();
        for (const w of ['united airlines', 'mileageplus', 'datapower', 'optum', 'unitedhealth', 'uhg', 'member benefit', 'personal-agent', 'personal agent']) if (t.includes(w)) hits.push(`${path.relative(root, p)}: ${w}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

test('the CI workflow is GitHub-hosted, Node 26 only, and carries the forbidden-strings and gitleaks jobs', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.ok(!/self-hosted/.test(ci));
  const versions = [...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 3 && versions.every((v) => v === '26'), versions.join());
  assert.match(ci, /forbidden-strings:/);
  assert.match(ci, /gitleaks/);
  assert.match(ci, /PORT=7609 npm run doctor/);
});

test('Node 26 everywhere: engines, .nvmrc, the Dockerfile', () => {
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=26');
  assert.match(read('.nvmrc').trim(), /^26/);
  const docker = read('Dockerfile');
  const froms = [...docker.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
  assert.ok(froms.length >= 2 && froms.every((f) => f === 'node:26-alpine'), froms.join());
});

test('the shared stylesheet is vendored, and app CSS has no colour literals, no dark-mode query, no !important', () => {
  const css = read('web/src/app.css');
  assert.ok(read('web/src/styles/standalone-ui.css').includes('standalone-ui.css: the shared UI standard'));
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  assert.doesNotMatch(css, /prefers-color-scheme|!important|font-style:\s*italic/);
  assert.doesNotMatch(read('web/src/main.jsx') + read('web/index.html'), /tokens\.css/);
});

test('forbidden code patterns are absent: process.env.MODE, EC key generation, a per-app .env loader, SE/hosted switches', () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (['node_modules', 'dist', '.git'].includes(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(js|jsx|mjs|sh|yml|json|md)$/.test(name) || /package-lock|repo\.test\.mjs$/.test(name)) continue;
      const t = fs.readFileSync(p, 'utf8');
      for (const [re, label] of [[/process\.env\.MODE\b/, 'process.env.MODE'], [/generateKeyPair(Sync)?\(\s*['"]ec['"]/, 'EC generateKeyPair'], [/loadEnvFile/, 'loadEnvFile'], [/APD_HOSTED|APD_PUBLIC_HOST|__SE_HOST__|__IMAGE__/, 'hosted/SE switch']]) {
        if (re.test(t) && !(/(settings|safety)\.test\.js$/.test(p) && ['loadEnvFile', 'hosted/SE switch'].includes(label))) hits.push(`${path.relative(root, p)}: ${label}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

test('the release banner and the tag labels the page shows are exactly the server\'s constants (the page shows them before the server has answered)', async () => {
  const server = await import('../server/src/releaseClaims.js');
  const web = fs.readFileSync(path.join(root, 'web/src/releaseText.js'), 'utf8');
  const quoted = (name) => new RegExp(`export const ${name} = '((?:[^'\\\\]|\\\\.)*)';`).exec(web)[1].replace(/\\'/g, "'");
  assert.equal(quoted('RELEASE_BANNER'), server.RELEASE_BANNER);
  assert.equal(quoted('NO_LIVE'), server.NO_LIVE);
  const labels = [.../TAG_LABELS = \{([^}]*)\}/.exec(web)[1].matchAll(/(\w+): '([^']*)'/g)].map((m) => m[2]);
  assert.deepEqual(labels, Object.values(server.CLAIM_TAGS));
});
