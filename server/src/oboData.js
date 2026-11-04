// On-behalf-of (slide 48): the gateway swaps the caller's verified token (RFC 8693) for one minted for the downstream MCP server, so the backend validates a
// token issued to it rather than trusting a shared service account; the act claim preserves who the original caller was. Text is {{token}} templated
// (see cast.js). Every host ends in .example; every token is MOCK-ISSUED here, for education. Values are invented; the config field NAMES are the console
// swagger's (modelMcpOBOSpec, 2026-10-31, schema only).

export const OBO_TITLE = 'On-behalf-of: {{castBrand}}\'s gateway swaps the caller token for one minted for the backend (RFC 8693)';
export const OBO_INTRO = 'The agent calls the gateway with a verified token. The gateway exchanges it at the issuer for a token whose audience is the backend MCP server, and forwards that one. The backend validates a token issued to it, and act names who the caller was. Run the scenarios, then change the backend or the requested scope and watch which check decides.';

// The lab clock. Every token in this tab is read against it, so a run never depends on the real time.
export const LAB_NOW = 1790000300;
export const EXCHANGED_LIFETIME = 300;
export const MAX_ACT_DEPTH = 3;

export const GATEWAY_AUD = 'https://gateway.{{castHost}}.example/mcp';
export const TRUSTED_ISSUER = 'https://pf.{{castHost}}.example';
export const USER_SUB = 'user-1001';

// Backends the gateway has an exchange config for. `id` is what the visitor picks; `resource` is the RFC 8707 resource indicator, the exchanged token's aud.
export const BACKENDS = [
  { id: 'orders', resource: 'https://mcp.{{castHost}}.example/orders/mcp', scopes: ['orders:read', 'orders:write'] },
  { id: 'reports', resource: 'https://mcp.{{castHost}}.example/reports/mcp', scopes: ['reports:read'] },
];
// Resource choices the page offers. `unlisted` is a well-formed URL no exchange config knows; `none` leaves Resource blank.
export const UNLISTED_RESOURCE = 'https://mcp.{{castHost}}.example/unlisted/mcp';
export const RESOURCE_CHOICES = ['orders', 'reports', 'unlisted', 'none'];

// The exchange config in the console swagger's field names (modelMcpOBOSpec). ClientSecret and PrivateKeyPEM exist in the schema and are write-only:
// this lab neither holds nor shows them.
export const OBO_CONFIG = {
  TokenURL: 'https://pf.{{castHost}}.example/as/token.oauth2',
  ClientID: 'gateway-exchange-client',
  AuthMethod: 'client_secret_basic',
  Resource: 'https://mcp.{{castHost}}.example/orders/mcp',
  Scope: 'orders:read',
  SubjectTokenType: '',
  RequestedTokenType: '',
};

const base = (id, extra = {}) => ({
  iss: TRUSTED_ISSUER, sub: USER_SUB, aud: GATEWAY_AUD, client_id: '{{castClientId}}', scope: 'orders:read orders:write',
  iat: LAB_NOW - 300, exp: LAB_NOW + 300, jti: `jti-${id}`, ...extra,
});

// A scenario: the inbound (caller) token's claims, what the exchange asks for, and the check that should decide. `tamper` changes a claim AFTER the
// token was signed (so the signature no longer matches); `replay` runs the same inbound token through the exchange twice.
export const OBO_SCENARIOS = [
  { id: 'allowed', title: 'Allowed: a token minted for the backend', expected: 'allow', code: null, evidence: 'reading', lesson: 'The caller token was issued to the gateway, so the gateway exchanges it. The backend gets a new token. Its aud is the backend, its sub is still the user, and act names the agent that called.', inbound: base('allowed'), request: { resource: 'orders', scope: 'orders:read' } },
  { id: 'chain', title: 'Allowed: the act claim chain grows', expected: 'allow', code: null, evidence: 'reading', lesson: 'The caller token already carries an act (a planner agent acted first). The exchange puts the current caller outermost and nests the earlier one beneath it, one level per hop (RFC 8693 section 4.1).', inbound: base('chain', { act: { sub: 'planner-agent' } }), request: { resource: 'orders', scope: 'orders:read' } },
  { id: 'wrong-audience', title: 'Denied: the caller token was not issued to the gateway', expected: 'deny', code: 'wrong_audience', evidence: 'reading', lesson: 'The gateway only exchanges tokens issued to it. A token minted for some other service is refused before the issuer is asked.', inbound: base('wrong-audience', { aud: 'https://other.{{castHost}}.example/api' }), request: { resource: 'orders', scope: 'orders:read' } },
  { id: 'expired', title: 'Denied: the caller token has expired', expected: 'deny', code: 'expired', evidence: 'reading', lesson: 'The lab clock is past exp. An expired token is not exchanged.', inbound: base('expired', { iat: LAB_NOW - 900, exp: LAB_NOW - 60 }), request: { resource: 'orders', scope: 'orders:read' } },
  { id: 'bad-signature', title: 'Denied: a claim was changed after signing', expected: 'deny', code: 'bad_signature', evidence: 'reading', lesson: 'The scope claim was widened after the token was signed, so the signature the lab recomputes does not match. The lab\'s signature is a keyed hash, a stand-in for a real one.', inbound: base('bad-signature'), tamper: { scope: 'orders:read orders:write admin:all' }, request: { resource: 'orders', scope: 'orders:read' } },
  { id: 'untrusted-issuer', title: 'Denied: the caller token came from an issuer the gateway does not trust', expected: 'deny', code: 'untrusted_issuer', evidence: 'reading', lesson: 'Only the configured issuer\'s tokens are exchanged.', inbound: base('untrusted-issuer', { iss: 'https://rogue.{{castHost}}.example' }), request: { resource: 'orders', scope: 'orders:read' } },
  { id: 'no-subject', title: 'Denied: the caller token names no user', expected: 'deny', code: 'no_subject', evidence: 'invented', lesson: 'On behalf of whom? Without a sub there is nobody to carry to the backend, so the lab refuses.', inbound: base('no-subject', { sub: '' }), request: { resource: 'orders', scope: 'orders:read' } },
  { id: 'replay', title: 'Denied: the same caller token is presented twice', expected: 'deny', code: 'replayed', evidence: 'invented', lesson: 'The first exchange works; the second use of the same jti is refused. Replay protection is a lab-invented check, not a claim about the real gateway.', inbound: base('replay'), replay: true, request: { resource: 'orders', scope: 'orders:read' } },
  { id: 'chain-too-deep', title: 'Denied: the act chain is already as deep as the lab allows', expected: 'deny', code: 'chain_too_deep', evidence: 'invented', lesson: 'The exchange would add one more level. The lab caps the chain at three actors.', inbound: base('chain-too-deep', { act: { sub: 'agent-a', act: { sub: 'agent-b', act: { sub: 'agent-c' } } } }), request: { resource: 'orders', scope: 'orders:read' } },
  { id: 'no-resource', title: 'Denied: no Resource is configured', expected: 'deny', code: 'resource_missing', evidence: 'reading', lesson: 'Resource becomes the exchanged token\'s aud (the audience the backend validates). Left blank there is no audience to mint for.', inbound: base('no-resource'), request: { resource: 'none', scope: 'orders:read' } },
  { id: 'unknown-resource', title: 'Denied: the Resource is not a backend the gateway knows', expected: 'deny', code: 'unknown_resource', evidence: 'invented', lesson: 'A resource indicator with no exchange config behind it is refused.', inbound: base('unknown-resource'), request: { resource: 'unlisted', scope: 'orders:read' } },
  { id: 'scope-widening', title: 'Denied: the exchange asks for more scope than the caller holds', expected: 'deny', code: 'scope_widening', evidence: 'invented', lesson: 'An exchange may narrow what the caller holds, never widen it. The caller holds orders:read and orders:write; admin:all is not among them.', inbound: base('scope-widening'), request: { resource: 'orders', scope: 'orders:read admin:all' } },
  { id: 'scope-not-for-backend', title: 'Denied: the scope is not one this backend offers', expected: 'deny', code: 'scope_not_for_backend', evidence: 'invented', lesson: 'The caller holds orders:write, but the reports backend offers only reports:read, so a token for it cannot carry orders:write.', inbound: base('scope-not-for-backend'), request: { resource: 'reports', scope: 'orders:write' } },
];

// Which claim each row of the exchanged token comes from, and how well we know it. Tags are CLAIM_TAGS keys.
export const CLAIM_ROWS = [
  { claim: 'aud', tag: 'reading', note: 'The console swagger says Resource (RFC 8707) is the exchanged token\'s aud, the audience the backend validates.' },
  { claim: 'act', tag: 'deck', note: 'Slide 48: the act claim preserves who the original caller was. Nesting an earlier act beneath it is the lab\'s reading of RFC 8693 section 4.1.' },
  { claim: 'sub', tag: 'reading', note: 'The user the caller acted for is carried unchanged: that is what on-behalf-of means in this lab.' },
  { claim: 'iss', tag: 'invented', note: 'The lab\'s mock issuer.' },
  { claim: 'client_id', tag: 'invented', note: 'The exchange client the gateway authenticates as (ClientID in the config).' },
  { claim: 'scope', tag: 'invented', note: 'The narrowing rule (never wider than the caller holds, only scopes the backend offers) is the lab\'s own.' },
  { claim: 'iat', tag: 'invented', note: 'The lab clock.' },
  { claim: 'exp', tag: 'invented', note: 'The lab caps the exchanged token at five minutes, and never past the caller token\'s own exp.' },
  { claim: 'jti', tag: 'invented', note: 'A hash of the caller\'s jti and the resource.' },
];

// One row per field of the exchange config shown on the page: the swagger name proves the field exists, nothing more.
export const CONFIG_ROWS = [
  { field: 'TokenURL', tag: 'swagger' }, { field: 'ClientID', tag: 'swagger' }, { field: 'ClientSecret', tag: 'swagger', note: 'write-only here: the lab holds none' },
  { field: 'AuthMethod', tag: 'swagger' }, { field: 'Resource', tag: 'swagger' }, { field: 'Scope', tag: 'swagger' }, { field: 'PrivateKeyPEM', tag: 'swagger', note: 'write-only here: the lab holds none' },
  { field: 'KeyID', tag: 'swagger' }, { field: 'SubjectTokenType', tag: 'swagger' }, { field: 'RequestedTokenType', tag: 'swagger' }, { field: 'Redeem', tag: 'swagger', note: 'the ID-JAG second leg: not modelled in this lab' },
];

// Facts, each tagged. `source` says where it comes from.
export const OBO_FACTS = [
  { id: 'deck-obo', tag: 'deck', text: 'NEW: the gateway swaps the caller\'s verified token (RFC 8693) for one minted specifically for the downstream MCP server, so the backend validates a token issued to it rather than trusting a shared service account. The act claim preserves who the original caller was.', source: 'deck slide 48' },
  { id: 'swagger-names', tag: 'swagger', text: 'modelMcpOBOSpec: TokenURL, ClientID, ClientSecret, AuthMethod, Resource, Scope, PrivateKeyPEM, KeyID, SubjectTokenType, RequestedTokenType, Redeem. A name proves the field exists, not how it behaves.', source: 'console swagger 2026-10-31, schema only' },
  { id: 'resource-is-aud', tag: 'reading', text: 'Resource (RFC 8707) is the exchanged token\'s aud: the audience the backend validates. This is our reading of the field\'s description in the swagger; it was not run.', source: 'swagger description of Resource, read 2026-10-31' },
  { id: 'cache-not-modelled', tag: 'reading', text: 'The swagger description says the exchanged token is cached per caller and app, and that only MCP apps can use this mode (A2A and plain HTTP apps cannot express it). This lab models neither.', source: 'swagger description of the OBO mode, read 2026-10-31' },
  { id: 'checks-invented', tag: 'invented', text: 'Everything that decides a verdict here is the lab\'s own: the order of the checks, the replay check, the three-actor cap on the act chain, the narrowing of scope, the five-minute lifetime, the status codes and the keyed-hash signature. No real gateway was run.', source: 'this lab' },
  { id: 'obo-not-on-tenant', tag: 'measured', text: 'The gateway the owner runs is on v1.261030 and the release tag was not in ECR on 2026-10-31, so nothing in this tab was run against a release gateway.', source: 'owner note, 2026-10-31' },
];

export const OBO_TALK = { id: 'obo', title: 'On-behalf-of (Ping release claim)', say: 'Ping release claim, UNVERIFIED on our tenant. The deck says the gateway swaps the caller\'s verified token for one minted for the downstream MCP server (RFC 8693), so the backend validates a token issued to it instead of trusting a shared service account, and the act claim keeps who called. Here that is the lab\'s own model: pick a scenario and watch which check decides, then change the backend or the requested scope. Every row says whether it is a deck claim, a swagger field name, our reading, our invention or something we measured.' };
