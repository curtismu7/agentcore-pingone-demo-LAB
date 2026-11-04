// Pure claim matching: no I/O, no clocks, no regex fed by user text beyond fixed-shape paths.
// A token is a JSON object. `flattenClaims` turns it into dotted paths (act.sub); `evaluateClaims` checks a rule's
// RequiredClaims against those paths. Nested matching only works when the parent is a real OBJECT: the text "{}" is not one.
// Hostile input is bounded (depth, keys, string length, rule size) and walked iteratively (Node 22 has a small stack).
import { maskKeepShape } from './credentials.js';

export const LIMITS = { name: 64, depth: 6, keys: 200, string: 512, required: 8, arrayItems: 20 };
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,31}(\.[A-Za-z0-9_-]{1,32}){0,5}$/;

export class ClaimsInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Flatten to a Map of dotted path -> scalar leaf. Arrays use their index (aud.0). Empty objects/arrays leave no leaf. */
export function flattenClaims(token) {
  if (!isObj(token)) throw new ClaimsInputError('bad_token', 'token must be a JSON object');
  const flat = new Map();
  const stack = [{ value: token, path: '', depth: 0 }];
  let seen = 0;
  while (stack.length) {
    const { value, path, depth } = stack.pop();
    if (isScalar(value)) {
      if (typeof value === 'string' && value.length > LIMITS.string) throw new ClaimsInputError('too_long', `a value is longer than ${LIMITS.string}`);
      flat.set(path, value);
      continue;
    }
    if (depth >= LIMITS.depth) throw new ClaimsInputError('too_deep', `nesting deeper than ${LIMITS.depth}`);
    const entries = Array.isArray(value) ? value.slice(0, LIMITS.arrayItems).map((v, i) => [String(i), v]) : Object.entries(value);
    if (Array.isArray(value) && value.length > LIMITS.arrayItems) throw new ClaimsInputError('too_many', `more than ${LIMITS.arrayItems} array items`);
    for (const [k, v] of entries) {
      if (++seen > LIMITS.keys) throw new ClaimsInputError('too_many', `more than ${LIMITS.keys} claims`);
      if (k.length > LIMITS.name) throw new ClaimsInputError('too_long', `a claim name is longer than ${LIMITS.name}`);
      // A dot in a claim NAME would collide with the dotted path of a nested claim ("act.sub" vs {act:{sub}}), so it is refused.
      if (!Array.isArray(value) && k.includes('.')) throw new ClaimsInputError('dotted_claim_name', 'a claim name contains a dot, which would be confused with a nested path');
      stack.push({ value: v, path: path ? `${path}.${k}` : k, depth: depth + 1 });
    }
  }
  return new Map([...flat].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function validateRule(rule) {
  if (!isObj(rule)) throw new ClaimsInputError('bad_rule', 'rule must be a JSON object');
  const req = rule.requiredClaims;
  if (!Array.isArray(req) || req.length < 1 || req.length > LIMITS.required) throw new ClaimsInputError('bad_rule', `requiredClaims must list 1 to ${LIMITS.required} claims`);
  for (const r of req) {
    if (!isObj(r) || typeof r.path !== 'string' || !PATH_RE.test(r.path)) throw new ClaimsInputError('bad_rule', 'each required claim needs a dotted path such as act.sub');
    if (typeof r.equals !== 'string' || r.equals.length < 1 || r.equals.length > LIMITS.string) throw new ClaimsInputError('bad_rule', 'each required claim needs a non-empty text value in equals');
  }
  return req.map((r) => ({ path: r.path, equals: r.equals }));
}

// A typed value quoted back inside a message: credential-shaped text is masked BEFORE it is quoted (quoting escapes characters and would hide it from a later pass).
const shown = (v) => maskKeepShape(v);

// Why a path is not there: the nearest ancestor that exists but is not an object is the real cause (the "{}" trap).
function whyMissing(flat, path) {
  const parts = path.split('.');
  for (let i = parts.length - 1; i >= 1; i--) {
    const parent = parts.slice(0, i).join('.');
    if (flat.has(parent)) return { reason: 'parent_not_object', detail: `${parent} is the ${typeof flat.get(parent)} ${JSON.stringify(shown(flat.get(parent)))}, not an object, so ${path} does not exist` };
  }
  return { reason: 'missing', detail: `${path} is not in the token` };
}

/** Pure. Returns { decision: 'allow'|'deny', checks, flat }. Throws ClaimsInputError on malformed or oversized input. */
export function evaluateClaims(token, rule) {
  const flat = flattenClaims(token);
  const required = validateRule(rule);
  const checks = required.map(({ path, equals }) => {
    if (!flat.has(path)) return { path, expected: equals, actual: null, ok: false, ...whyMissing(flat, path) };
    const actual = flat.get(path);
    if (actual === equals) return { path, expected: equals, actual, ok: true, reason: 'match', detail: `${path} equals the required value` };
    if (typeof actual !== 'string') return { path, expected: equals, actual, ok: false, reason: 'type_mismatch', detail: `${path} is ${typeof actual}, a text value is required` };
    return { path, expected: equals, actual, ok: false, reason: 'mismatch', detail: `${path} is "${shown(actual)}", not the required value` };
  });
  return {
    decision: checks.every((c) => c.ok) ? 'allow' : 'deny',
    checks,
    flat: [...flat].map(([path, value]) => ({ path, value })),
  };
}
