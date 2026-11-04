// The story as data: a mock PingOne agent token (M2M, client_credentials) and five scenarios.
// Text is {{token}} templated (see cast.js) so brand, agent id, client id and host come from customer.config.json or a vertical.
// Every host ends in .example. Every token is MOCK-ISSUED here, for education: no real credential, tenant or customer.
// Source for the shapes: the bedrock-agentcore-pingone skill (M2M section, verified on the Ridgeline build, 2026-08-12).
// Values are invented; only the SHAPE comes from that source.

import { THREE_LO_TALK } from './threeLoData.js';
import { OBO_TALK } from './oboData.js';
import { whyTalk, NO_LIVE } from './releaseClaims.js';

export const BANNER = 'SIMULATED, MOCK mode: a mock PingOne token and mock AgentCore checks. Nothing here calls a real gateway, identity provider, AWS account or tenant.';

export const TITLE = 'M2M gate: the agent\'s own token from PingOne';
export const INTRO = 'The agent on AgentCore Runtime asks AgentCore Identity for a PingOne token with oauth2_flow=M2M (client_credentials). No human, no browser. The downstream rule requires client_id and act.sub to equal the registered agent. Run five tokens and see exactly which claim decided.';

// status: measured = seen on the verified build; inferred = our reading; UNVERIFIED = not confirmed by any Ping source.
export const FACTS = [
  { id: 'm2m-shape', status: 'measured', text: 'With oauth2_flow="M2M" the AgentCore call returns accessToken directly: no callback_url, no polling, no pre-registration. This was verified on a real build (bedrock-agentcore SDK 1.21.0).', source: 'bedrock-agentcore-pingone skill, M2M section, verified 2026-08-12' },
  { id: 'act-must-be-object', status: 'measured', text: 'act must be an OBJECT such as {"sub": "{{castAgentId}}"}. Emitted as the text "{}" it does not work.', source: 'PF token exchange recipe, access token mapping step, verified live 2026-10-26' },
  { id: 'required-claims-pin-agent', status: 'measured', text: 'The agent is pinned by the identity\'s required claims client_id and act.sub, while the subject stays open (*).', source: 'PF token exchange recipe, Working configuration table' },
  { id: 'region-role', status: 'measured', text: 'A runtime role that trusts one region fails role validation if the shell\'s AWS_REGION overrides the .env: the role only trusts the region it was created in.', source: 'gotcha #29, from the Ridgeline build' },
  { id: 'checks-invented', status: 'inferred', text: 'The rule here (required claims client_id and act.sub) and the order of the checks are the lab\'s own model of a downstream policy.', source: 'this lab' },
];

export const RULE = {
  name: 'Registered agent only (mock)',
  appliesTo: 'Agent API https://api.{{castHost}}.example/orders',
  note: 'Mock shape of a downstream policy rule with required claims. Not exported from, or checked against, a real console.',
  requiredClaims: [
    { path: 'client_id', equals: '{{castClientId}}' },
    { path: 'act.sub', equals: '{{castAgentId}}' },
  ],
};

const HEADER = { alg: 'RS256', kid: 'mock-key-1', typ: 'at+jwt' };
const base = () => ({
  iss: 'https://auth.pingone.{{castHost}}.example/as',
  sub: '{{castClientId}}',
  aud: 'https://api.{{castHost}}.example/orders',
  client_id: '{{castClientId}}',
  iat: 1790000000,
  exp: 1790000600,
});
const token = (claims) => ({ header: HEADER, claims, signature: '<MOCK-SIGNATURE: not a real signature>' });

export const SCENARIOS = [
  { id: 'allowed', title: 'Allowed: act.sub matches', expected: 'allow', lesson: 'client_id and act.sub both equal the registered agent, so the rule passes.', token: token({ ...base(), act: { sub: '{{castAgentId}}' } }) },
  { id: 'wrong-act-sub', title: 'Denied: act.sub is a different agent', expected: 'deny', lesson: 'The token is valid and signed, but it acts for another agent. The nested claim decides, not the signature.', token: token({ ...base(), act: { sub: 'other-agent' } }) },
  { id: 'no-act', title: 'Denied: no act claim at all', expected: 'deny', lesson: 'Without act there is no act.sub to match. A token that proves only a client is not enough for this rule.', token: token(base()) },
  { id: 'act-text', title: 'Denied: act emitted as the text "{}"', expected: 'deny', lesson: 'The real trap: the token mapping produced the text "{}" instead of an object, so act.sub does not exist. Fix the mapping expression, not the rule.', token: token({ ...base(), act: '{}' }) },
  { id: 'wrong-client', title: 'Denied: wrong client_id', expected: 'deny', lesson: 'act.sub is right but client_id names another client. Both required claims must match.', token: token({ ...base(), client_id: 'unregistered-client', act: { sub: '{{castAgentId}}' } }) },
];

// The talk track, as data, so the web talk-track view and presenter mode read the same words as docs/talk-track.md.
export const TALK_TRACK = [
  { id: 'say-first', title: 'Say first', say: 'Everything here is simulated. The tokens, the rules and the step data are invented by this app; only their shape follows what we measured on a real AgentCore + PingOne build.' },
  { id: 'm2m', title: 'M2M: the agent\'s own token', say: 'The agent asks AgentCore Identity for a PingOne token with oauth2_flow=M2M: client_credentials, no human, no browser, the call returns the accessToken directly. The token carries client_id and an act object with sub = the agent. The downstream rule requires both to equal the registered agent. Walk the five scenarios: allowed, wrong act.sub, no act, act as the text "{}", wrong client_id.' },
  { id: 'trap', title: 'The "{}" trap', say: 'The mapping produced the string "{}" instead of an object, so act.sub does not exist. The fix is the mapping expression (it must produce an object), not the rule.' },
  THREE_LO_TALK,
  { id: 'three-lo-vs-m2m', title: 'M2M or 3LO: when to pick which', say: 'M2M when the agent acts as itself: the token names the agent client and nothing else. USER_FEDERATION when a human must be accountable: the token carries that human\'s sub, and downstream delegation via RFC 8693 puts the human in sub and the agent in act.sub. The on-behalf-of tab shows that exchange.' },
  OBO_TALK,
  whyTalk('obo'),
  { id: 'unverified', title: 'What we do not claim', say: 'The step order, the error codes, the sixty-second code lifetime and the user store in the USER_FEDERATION tab are this lab\'s own model. What we measured on the real build are the four shapes: the two-callback match, POST auth at the token endpoint, the sessionUri-keyed pre-registration, and the workload-identity-directory ARN in the runtime role.' },
  { id: 'close', title: 'Close', say: `Reset clears your workspace. Nothing was sent anywhere. ${NO_LIVE}` },
];
