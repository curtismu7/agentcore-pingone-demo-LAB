// Pure engine for the on-behalf-of tab. No I/O, no real clock: every token is read against the lab clock. The signature is a keyed hash that the lab
// computes and recomputes (a stand-in for a real signature, labelled MOCK-HS256): change a claim after signing and the check fails. The inputs that
// decide a verdict are checked here, in a fixed order; the first failing check refuses. Bounded: the act chain is walked iteratively and capped.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { refuse } from './errors.js';
import { looksLikeCredential } from './credentials.js';

// A lab constant, not a secret: it only makes the stand-in signature recomputable. Anyone reading this can forge a lab token, which is the point of a mock.
const LAB_SIGNING_LABEL = 'gcl-lab-mock-signing-label-not-a-secret';
export const SCOPE_LIMITS = { text: 200, count: 10, name: 64 };
const SCOPE_NAME = /^[A-Za-z0-9:._-]{1,64}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sortKeys = (v, depth = 0) => {
  if (depth > 8 || !isObj(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k], depth + 1)]));
};
export const canonical = (claims) => JSON.stringify(sortKeys(claims));
export const mockSignature = (claims) => createHmac('sha256', LAB_SIGNING_LABEL).update(canonical(claims)).digest('base64url');
const sameSig = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const HEADER = { alg: 'MOCK-HS256', kid: 'lab-mock-1', typ: 'at+jwt' };
export const issueMockToken = (claims) => ({ header: HEADER, claims, signature: mockSignature(claims) });
export const signatureValid = (tok) => isObj(tok) && isObj(tok.claims) && sameSig(tok.signature, mockSignature(tok.claims));

/** "orders:read orders:write" -> ['orders:read', 'orders:write']. Space separated like an OAuth scope claim; bounded; a credential-shaped scope is refused, never echoed. */
export function parseScope(text) {
  if (typeof text !== 'string') throw refuse('bad_scope', 'scope must be text');
  if (text.length > SCOPE_LIMITS.text) throw refuse('bad_scope', 'scope text is too long');
  if (looksLikeCredential(text)) throw refuse('credential_like', 'that text looks like a credential, so it was not used');
  const parts = text.split(' ').filter(Boolean);
  if (parts.length > SCOPE_LIMITS.count) throw refuse('bad_scope', 'too many scope names');
  if (!parts.every((p) => SCOPE_NAME.test(p))) throw refuse('bad_scope', 'a scope name has a character the lab does not take');
  return [...new Set(parts)];
}

/** Actors in an act chain, outermost first. Iterative and capped; a non-object act is a trap (returns { bad: true }). */
export function actChain(act, cap = 8) {
  const chain = [];
  let cur = act;
  while (cur !== undefined) {
    if (!isObj(cur) || typeof cur.sub !== 'string' || cur.sub === '') return { bad: true, chain };
    chain.push(cur.sub);
    if (chain.length > cap) return { bad: true, chain };
    cur = cur.act;
  }
  return { bad: false, chain };
}

const audList = (aud) => (Array.isArray(aud) ? aud : [aud]).filter((a) => typeof a === 'string');

/** What a backend does with a token: valid signature, audience is this backend, not expired. */
export function backendValidate(tok, audience, now) {
  if (!signatureValid(tok)) return { accepted: false, why: 'the signature does not match' };
  if (!audList(tok.claims.aud).includes(audience)) return { accepted: false, why: 'the audience is not this backend' };
  if (!(Number(tok.claims.exp) > now)) return { accepted: false, why: 'the token has expired' };
  return { accepted: true, why: 'issued to this backend, signature matches, not expired' };
}

// The check ids, in the order they run, with the lab-reading tag each carries.
export const CHECKS = [
  ['inbound_signature', 'reading', 'The caller token\'s signature must match'],
  ['inbound_issuer', 'reading', 'The caller token must come from the configured issuer'],
  ['inbound_expiry', 'reading', 'The caller token must not be expired'],
  ['inbound_audience', 'reading', 'The caller token must have been issued to the gateway'],
  ['inbound_subject', 'invented', 'The caller token must name a user'],
  ['replay', 'invented', 'The caller token\'s jti must not have been used before'],
  ['act_chain', 'invented', 'The act chain must be well formed and short enough to extend'],
  ['resource', 'reading', 'Resource must name a backend the gateway has an exchange config for'],
  ['scope', 'invented', 'The requested scope must be within what the caller holds and what the backend offers'],
];
const FAIL = {
  bad_signature: ['inbound_signature', 401, 'invalid_token'], untrusted_issuer: ['inbound_issuer', 401, 'invalid_token'], expired: ['inbound_expiry', 401, 'invalid_token'],
  wrong_audience: ['inbound_audience', 401, 'invalid_token'], no_subject: ['inbound_subject', 401, 'invalid_token'], replayed: ['replay', 401, 'invalid_token'],
  bad_act: ['act_chain', 400, 'invalid_request'], chain_too_deep: ['act_chain', 403, 'access_denied'], resource_missing: ['resource', 400, 'invalid_target'], unknown_resource: ['resource', 400, 'invalid_target'],
  scope_widening: ['scope', 400, 'invalid_scope'], scope_not_for_backend: ['scope', 400, 'invalid_scope'],
};

/**
 * Exchange one inbound token. `cfg` carries the lab constants (clock, gateway audience, trusted issuer, exchange client, depth cap, lifetime) and `backends`
 * the exchange configs ({ id, resource, scopes }). `request` is { resource (a URL or ''), scope (a list) }. `seen` is the set of jtis already used.
 * Never mutates its inputs except `seen`, which is added to only when every check before the replay check passed.
 */
export function exchangeOnBehalfOf({ inbound, request, cfg, backends, seen }) {
  const checks = [];
  const verdict = (code, detail) => {
    checks.push({ id: FAIL[code][0], ok: false, code, detail });
    const [, status, oauthError] = FAIL[code];
    return { decision: 'deny', status, oauthError, code, checks: [...checks, ...CHECKS.slice(checks.length).map(([id]) => ({ id, ok: null, detail: 'not reached' }))], exchanged: null };
  };
  const pass = (id, detail) => checks.push({ id, ok: true, detail });
  const claims = isObj(inbound?.claims) ? inbound.claims : {};

  if (!signatureValid(inbound)) return verdict('bad_signature', 'the signature the lab recomputes does not match the claims');
  pass('inbound_signature', 'the signature matches the claims');
  if (claims.iss !== cfg.trustedIssuer) return verdict('untrusted_issuer', 'the issuer is not the configured one');
  pass('inbound_issuer', 'the issuer is the configured one');
  if (!(Number(claims.exp) > cfg.now)) return verdict('expired', 'exp is not after the lab clock');
  pass('inbound_expiry', 'exp is after the lab clock');
  if (!audList(claims.aud).includes(cfg.gatewayAud)) return verdict('wrong_audience', 'aud does not include the gateway');
  pass('inbound_audience', 'aud includes the gateway');
  if (typeof claims.sub !== 'string' || claims.sub === '') return verdict('no_subject', 'there is no sub to act for');
  pass('inbound_subject', 'sub names the user');
  if (typeof claims.jti === 'string' && seen.has(claims.jti)) return verdict('replayed', 'this jti was already exchanged');
  pass('replay', 'the jti has not been used');
  const chain = actChain(claims.act);
  if (chain.bad) return verdict('bad_act', 'act is not an object with a sub');
  if (chain.chain.length >= cfg.maxActDepth) return verdict('chain_too_deep', `the chain already has ${chain.chain.length} actors; the lab allows ${cfg.maxActDepth}`);
  pass('act_chain', `${chain.chain.length} actor(s) so far; one more is allowed`);
  if (request.resource === '') return verdict('resource_missing', 'Resource is blank');
  const backend = backends.find((b) => b.resource === request.resource);
  if (!backend) return verdict('unknown_resource', 'Resource is not one of the configured backends');
  pass('resource', `Resource names the ${backend.id} backend`);
  const held = new Set(String(claims.scope ?? '').split(' ').filter(Boolean));
  if (request.scope.some((s) => !held.has(s))) return verdict('scope_widening', 'the request names a scope the caller does not hold');
  if (request.scope.some((s) => !backend.scopes.includes(s))) return verdict('scope_not_for_backend', 'the request names a scope this backend does not offer');
  const granted = request.scope.length ? request.scope : [...held].filter((s) => backend.scopes.includes(s));
  pass('scope', `granted ${granted.join(' ') || '(none)'}`);

  if (typeof claims.jti === 'string') seen.add(claims.jti);
  const exchangedClaims = {
    iss: cfg.trustedIssuer,
    sub: claims.sub,
    aud: backend.resource,
    client_id: cfg.exchangeClientId,
    scope: granted.join(' '),
    iat: cfg.now,
    exp: Math.min(Number(claims.exp), cfg.now + cfg.lifetime),
    jti: `x-${createHash('sha256').update(`${claims.jti ?? ''}|${backend.resource}`).digest('hex').slice(0, 12)}`,
    act: { sub: typeof claims.client_id === 'string' ? claims.client_id : 'unknown-caller', ...(claims.act !== undefined ? { act: claims.act } : {}) },
  };
  return { decision: 'allow', status: 200, oauthError: null, code: null, checks, exchanged: issueMockToken(exchangedClaims), backend: { id: backend.id, resource: backend.resource } };
}

/** What the backend sees, computed from the tokens (never typed in): validation of the exchanged and the original token, and the attribution in its log. */
export function backendView({ inbound, result, cfg }) {
  if (result.decision !== 'allow') return null;
  const ex = result.exchanged;
  const aud = result.backend.resource;
  const chain = actChain(ex.claims.act).chain;
  return {
    audience: aud,
    exchanged: backendValidate(ex, aud, cfg.now),
    original: backendValidate(inbound, aud, cfg.now),
    differs: canonical(ex.claims) !== canonical(inbound.claims),
    logWithOnBehalfOf: `user=${ex.claims.sub} actor=${chain.join(' > ')} client=${ex.claims.client_id}`,
    logWithSharedServiceAccount: 'user=(unknown) actor=(unknown) client=svc-gateway-shared',
  };
}
