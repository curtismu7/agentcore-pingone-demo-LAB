import { looksLikeCredential } from './credentials.js';
// Rule 13: a workspace id keeps one visitor's state apart from another's. The only server state is each workspace's recent
// evaluations. The browser sends its id in X-Workspace (default "default"); state is bounded in count, size and age.
export const WORKSPACE_RE = /^[a-z0-9-]{1,40}$/;
export const DEFAULT_WORKSPACE = 'default';
export const MAX_RUNS = 20;

export function workspaceFrom(req) {
  const raw = req.headers['x-workspace'];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  // An id that looks like a credential (a long mixed run, a token prefix) is refused rather than echoed back in the `workspace` field of an answer.
  return typeof raw === 'string' && WORKSPACE_RE.test(raw) && !looksLikeCredential(raw) ? raw : null;
}

export function createWorkspaces({ max = 500, ttlMs = 60 * 60 * 1000, now = Date.now } = {}) {
  const map = new Map(); // id -> { runs, at }; insertion order = oldest first
  const sweep = () => {
    const t = now();
    for (const [id, v] of map) { if (t - v.at > ttlMs) map.delete(id); else break; }
    while (map.size > max) map.delete(map.keys().next().value);
  };
  return {
    runs(id) { sweep(); const v = map.get(id); return { workspace: id, runs: v ? v.runs : [] }; },
    record(id, run) {
      const prev = map.get(id);
      const runs = [...(prev ? prev.runs : []), { ...run, at: now() }].slice(-MAX_RUNS);
      map.delete(id); map.set(id, { runs, at: now() }); sweep();
      return this.runs(id);
    },
    reset(id) { map.delete(id); },
    size() { return map.size; },
  };
}
