import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, resolvePort } from './safety.js';
import { createMode } from './mode.js';
import { applySharedSettings } from './settings.js';

installNetguard(); // before anything else can open a socket

// The one shared settings file (rulebook): ~/Development/.env, or STANDALONE_ENV. Optional; only this app's own key is taken; never printed.
applySharedSettings();

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[agentcore-pingone-demo-LAB] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const mode = createMode({ env: process.env });
const host = assertBindAllowed(bindHost(), process.env);
const { url } = await startHttpServer({ port: resolvePort(), host, app: createApp({ mode }) });
console.log(`[agentcore-pingone-demo-LAB] ${mode.source()} lab at ${url} (loopback, no outbound network)`);
console.log(`[agentcore-pingone-demo-LAB] health: ${url}api/health`);
