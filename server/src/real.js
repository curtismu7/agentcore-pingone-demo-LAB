// Whether Real mode can be offered. Real = the live engine (realEngine.js): AWS AgentCore Identity exchanges a
// real Workload Access Token for a real PingOne token (M2M). Owner-configured via ~/Development/.env:
// APD_REAL_ENGINE=1, AWS creds (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY [/ AWS_SESSION_TOKEN]), AWS_REGION,
// APD_REAL_WORKLOAD_NAME (a standalone AgentCore workload identity) and APD_REAL_PROVIDER_NAME (the CustomOauth2
// credential provider). No value is ever printed or returned. Without those, Real stays off with this reason.
import { loadSharedEnv } from './env.js';
import { realEngineConfigured } from './realEngine.js';

export const NO_REAL = 'Real mode is not available: it needs APD_REAL_ENGINE=1 plus AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION), APD_REAL_WORKLOAD_NAME and APD_REAL_PROVIDER_NAME in the shared settings file. The owner configures these; see the Real tab for the exact steps.';

export function realConfigured(env = process.env) {
  return realEngineConfigured(env, loadSharedEnv());
}
