// Defence in depth: every JSON answer of the release-update tabs passes through maskDeep, so a credential-shaped value can never leave in any field
// even if a code path forgot to clean its input. Iterative: a deep structure cannot overflow the stack. The generic long-run detectors are NOT applied
// here (ids, hashes, signatures and trace ids are long and legitimate); the specific token, key, bearer and assignment detectors are.
import { DETECTORS, maskKeepShape, maskSpans } from './credentials.js';

const SPECIFIC = DETECTORS.filter((d) => !d.generic);
// Values that are long on purpose and carry no secret: mock signatures, trace ids, the hash of a jti.
// The hop panes ('request', 'response') are built from fixed text and values already checked on the way in (scope tokens against a safe character set,
// ids against lists), and they hold lines such as "Authorization: Bearer <MOCK-ISSUED ...>" that the header detector would otherwise blank out.
const OPAQUE = new Set(['signature', 'traceparent', 'traceId', 'jti', 'request', 'response']);

export function maskResponseText(text) {
  const t = text;
  const spans = [];
  for (const d of SPECIFIC) { d.re.lastIndex = 0; for (const m of t.matchAll(d.re)) if (!d.accept || d.accept(m[0])) spans.push({ start: m.index, end: m.index + m[0].length, id: d.id }); }
  return spans.length ? maskSpans(t, spans) : t;
}

export function maskDeep(value) {
  const clone = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? {} : x);
  const root = { v: clone(value) };
  const work = [[value, root, 'v', false]];
  while (work.length) {
    const [src, dst, key, opaque] = work.pop();
    if (typeof src === 'string') { dst[key] = opaque ? src : maskResponseText(src); continue; }
    if (src === null || typeof src !== 'object') { dst[key] = src; continue; }
    const copy = clone(src); dst[key] = copy;
    for (const k of Object.keys(src).reverse()) work.push([src[k], copy, k, OPAQUE.has(k)]);
  }
  return root.v;
}

// Typed values shown back on purpose (custom claims, their names and the checks that quote them): EVERY string, the generic long-run detectors included,
// is masked with maskKeepShape; ordinary text and every non-string value come back unchanged. Iterative: depth cannot overflow the stack.
export function maskTypedDeep(value) {
  const clone = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? {} : x);
  const root = { v: clone(value) };
  const work = [[value, root, 'v']];
  while (work.length) {
    const [src, dst, key] = work.pop();
    if (typeof src === 'string') { dst[key] = maskKeepShape(src); continue; }
    if (src === null || typeof src !== 'object') { dst[key] = src; continue; }
    const copy = clone(src); dst[key] = copy;
    for (const k of Object.keys(src).reverse()) work.push([src[k], copy, k]);
  }
  return root.v;
}
