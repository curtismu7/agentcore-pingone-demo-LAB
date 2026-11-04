// Mock / Real. Rule 19: runtime server-side mode, POST /api/mode with exactly {source}, GET /api/info
// returns {source, realAvailable, realReason}. Default: Real if configured, else Mock.
// Real = a live AgentCore Runtime + PingOne tenant, configured from ~/Development/.env. The owner sets the
// credentials; agents never sign a person in. This build ships the Mock engine only: a Real engine (live AWS
// account + PingOne environment) is owner-run and not wired yet, so realAvailable is false until
// APD_REAL_ENGINE=1 and the PingOne worker settings are present.
import { loadSharedEnv } from './env.js';
import { NO_REAL, realConfigured } from './real.js';

export const MODES = ['mock', 'real'];

export function createMode({ env = process.env } = {}) {
  const canReal = realConfigured(env);
  const state = { source: canReal ? 'real' : 'mock' };
  return {
    info: () => ({ source: state.source, realAvailable: canReal, realReason: canReal ? null : NO_REAL }),
    source: () => state.source,
    set: (source) => { state.source = source; },
  };
}
export { loadSharedEnv };
