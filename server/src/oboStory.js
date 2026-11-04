import { fillDeep } from './cast.js';
import { refuse } from './errors.js';
import { BACKENDS, CLAIM_ROWS, CONFIG_ROWS, EXCHANGED_LIFETIME, GATEWAY_AUD, LAB_NOW, MAX_ACT_DEPTH, OBO_CONFIG, OBO_FACTS, OBO_INTRO, OBO_SCENARIOS, OBO_TITLE, RESOURCE_CHOICES, TRUSTED_ISSUER, UNLISTED_RESOURCE } from './oboData.js';
import { CLAIM_TAGS, NO_LIVE, RELEASE_BANNER, WHY } from './releaseClaims.js';
import { backendView, exchangeOnBehalfOf, issueMockToken, parseScope } from './obo.js';
import { newTrace } from './trace.js';

export const buildOboStory = (cast) => fillDeep({
  title: OBO_TITLE, intro: OBO_INTRO, scenarios: OBO_SCENARIOS, config: OBO_CONFIG, configRows: CONFIG_ROWS, claimRows: CLAIM_ROWS, facts: OBO_FACTS,
  backends: BACKENDS, resourceChoices: RESOURCE_CHOICES, labNow: LAB_NOW, maxActDepth: MAX_ACT_DEPTH,
  tags: CLAIM_TAGS, banner: RELEASE_BANNER, noLive: NO_LIVE, why: WHY.obo,
}, cast);

const cfgFor = (cast) => ({
  now: LAB_NOW, gatewayAud: fillDeep(GATEWAY_AUD, cast), trustedIssuer: fillDeep(TRUSTED_ISSUER, cast), exchangeClientId: OBO_CONFIG.ClientID,
  maxActDepth: MAX_ACT_DEPTH, lifetime: EXCHANGED_LIFETIME,
});

/** The visitor's own choices. `resource` is one of RESOURCE_CHOICES (an id, never a typed URL); `scope` is bounded text, checked in parseScope. */
export function normalizeOverrides(body) {
  const out = {};
  if (body.resource !== undefined) {
    if (typeof body.resource !== 'string' || !RESOURCE_CHOICES.includes(body.resource)) throw refuse('bad_resource', 'resource must be one of the listed backends');
    out.resource = body.resource;
  }
  if (body.scope !== undefined) out.scope = parseScope(body.scope);
  return out;
}

const resourceUrl = (choice, cast) => (choice === 'none' ? '' : choice === 'unlisted' ? fillDeep(UNLISTED_RESOURCE, cast) : fillDeep(BACKENDS.find((b) => b.id === choice).resource, cast));

/** Run one scenario by id, with optional overrides of the backend and the requested scope. Throws InputError (unknown scenario, bad override). */
export function evaluateOboScenario(story, id, overrides, cast, traceparent) {
  const sc = typeof id === 'string' ? story.scenarios.find((s) => s.id === id) : null;
  if (!sc) throw refuse('unknown_scenario', 'no such scenario');
  const cfg = cfgFor(cast);
  const backends = story.backends.map((b) => ({ id: b.id, resource: b.resource, scopes: b.scopes }));
  const choice = overrides.resource ?? sc.request.resource;
  const request = { resource: resourceUrl(choice, cast), scope: overrides.scope ?? parseScope(sc.request.scope) };
  const inbound = issueMockToken(sc.inbound);
  if (sc.tamper) inbound.claims = { ...inbound.claims, ...sc.tamper };
  const seen = new Set();
  const steps = [];
  if (sc.replay) steps.push({ label: 'First presentation', result: exchangeOnBehalfOf({ inbound, request, cfg, backends, seen }) });
  const result = exchangeOnBehalfOf({ inbound, request, cfg, backends, seen });
  steps.push({ label: sc.replay ? 'Second presentation of the same token' : 'Exchange', result });
  const trace = newTrace(traceparent);
  const hops = buildOboHops({ trace, cast, cfg, sc, request, result, config: story.config });
  return {
    scenario: sc.id, expected: sc.expected, request: { resource: request.resource, resourceChoice: choice, scope: request.scope.join(' ') },
    inbound, result, steps, backend: backendView({ inbound, result, cfg }),
    hops, traceId: trace.traceId, traceparent: hops[0].traceparent,
  };
}

// The three mock hops. Values here are fixed text and checked inputs (scope names against a safe character set, resources from a list).
function buildOboHops({ trace, cast, cfg, sc, request, result, config }) {
  const ids = [trace.span(), trace.span(), trace.span()];
  const tp = ids.map((x) => `00-${trace.traceId}-${x}-01`);
  const ok = result.decision === 'allow';
  const form = `grant_type=urn:ietf:params:oauth:grant-type:token-exchange\nsubject_token=<MOCK-ISSUED caller token, scenario: ${sc.id}>\nsubject_token_type=urn:ietf:params:oauth:token-type:access_token\nresource=${request.resource || '(blank)'}\nscope=${request.scope.join(' ') || '(none)'}`;
  return [
    { n: 1, from: 'agent', to: 'gateway', label: 'Agent calls the gateway with its token', traceparent: tp[0],
      request: `POST ${cfg.gatewayAud}\nAuthorization: Bearer <MOCK-ISSUED caller token, scenario: ${sc.id}>\ntraceparent: ${tp[0]}`,
      response: ok ? `HTTP/1.1 200 OK\ntraceparent: ${tp[0]}` : `HTTP/1.1 ${result.status}\ntraceparent: ${tp[0]}\n(${result.code})` },
    { n: 2, from: 'gateway', to: 'issuer', label: 'Gateway exchanges the token (RFC 8693)', traceparent: tp[1],
      request: `POST ${config.TokenURL}\nContent-Type: application/x-www-form-urlencoded\n(client authentication: ${config.AuthMethod}, credentials never shown)\ntraceparent: ${tp[1]}\n\n${form}`,
      response: ok ? `HTTP/1.1 200 OK\n{"access_token": "<MOCK-ISSUED exchanged token>", "issued_token_type": "urn:ietf:params:oauth:token-type:access_token", "token_type": "Bearer", "expires_in": ${Math.max(0, result.exchanged.claims.exp - result.exchanged.claims.iat)}}` : `(lab status ${result.status})\n{"error": "${result.oauthError}"}` },
    { n: 3, from: 'gateway', to: 'backend', label: 'Gateway calls the backend with the exchanged token', traceparent: tp[2],
      request: ok ? `POST ${result.backend.resource}\nAuthorization: Bearer <MOCK-ISSUED exchanged token>\ntraceparent: ${tp[2]}` : `(not sent: no exchanged token)\ntraceparent: ${tp[2]}`,
      response: ok ? 'HTTP/1.1 200 OK (the backend accepted a token issued to it)' : '(no call)' },
  ];
}
