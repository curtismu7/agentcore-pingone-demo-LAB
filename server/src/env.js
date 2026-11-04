// The one shared settings file, ~/Development/.env (or STANDALONE_ENV). Read-only, never returned, never logged:
// only whether the Real-mode variables exist. A bare MODE is NOT read: the shared file is read by every standalone
// app, and another app's MODE must not switch this one.
import fs from 'node:fs';

const CANDIDATES = () => {
  const list = [];
  if (process.env.STANDALONE_ENV) list.push(process.env.STANDALONE_ENV);
  list.push(`${process.env.HOME}/Development/.env`);
  return list;
};

export function loadSharedEnv() {
  for (const f of CANDIDATES()) {
    try {
      const text = fs.readFileSync(f, 'utf8');
      const out = {};
      for (const line of text.split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      return out;
    } catch { /* next candidate */ }
  }
  return {};
}
