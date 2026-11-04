// Whether Real mode can be offered. Real = a live AgentCore Runtime + PingOne tenant, owner-run: the settings
// come from ~/Development/.env and no value is ever printed or returned. This build ships no Real engine yet,
// so Real stays disabled until the owner wires it (APD_REAL_ENGINE=1 plus the PingOne worker settings).
import { loadSharedEnv } from './env.js';

export const NO_REAL = 'Real mode is not available in this build: it needs a live AgentCore Runtime, a PingOne worker app and a person access token, all owner-configured. This lab ships the Mock engine; the shape it models is what a Real run would follow.';

export function realConfigured(env = process.env) {
  const e = { ...env, ...loadSharedEnv() };
  // Off by default: the Real engine is not built. The owner opts in by building one and setting the flag.
  return Boolean(e.APD_REAL_ENGINE === '1' && e.PINGONE_ENVIRONMENT_ID && (e.PINGONE_WORKER_CLIENT_ID || e.PINGONE_WORKER_ID));
}
