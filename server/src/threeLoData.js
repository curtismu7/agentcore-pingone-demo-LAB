// USER_FEDERATION (3LO): the agent initiates a real human login through PingOne, and the returned token carries the
// human's sub. Text is {{token}} templated (see cast.js). Every host ends in .example; every token is MOCK-ISSUED here,
// for education. Source for the shapes: the bedrock-agentcore-pingone skill (gotchas #3, #4, #13, #18; verified on the
// Ridgeline build, 2026-08-12). Values are invented; only the SHAPES and the gotchas come from that source.

export const THREE_LO_TITLE = 'USER_FEDERATION: {{castBrand}}\'s agent logs a human in through PingOne (3LO)';
export const THREE_LO_INTRO = 'The agent on AgentCore Runtime starts a PingOne authorization-code flow. The human signs in (pi.flow), PingOne redirects to the callback with a code, and AgentCore Identity exchanges the code for a token whose sub is the human. Run the scenarios and watch which step decides.';

// The lab clock. Every token in this tab is read against it, so a run never depends on the real time.
export const LAB_NOW = 1790000300;
export const CODE_LIFETIME = 60;

export const PINGONE_ISSUER = 'https://auth.pingone.{{castHost}}.example/as';
export const RUNTIME_SESSION_ID = 'session-0123456789012345678901234567890'; // 40 chars: the lab's stand-in for AgentCore's min-33 rule (gotcha #26)
export const SESSION_URI = `https://bedrock-agentcore.{{castHost}}.example/sessions/${RUNTIME_SESSION_ID}/oauth2/callback`;
export const CALLBACK_URL = 'https://app.{{castHost}}.example/auth/callback';

// The one registered agent client in PingOne, and the AgentCore credential provider that wraps it.
export const PINGONE_APP = {
  clientId: '{{castClientId}}',
  redirectUri: CALLBACK_URL,
  tokenEndpointAuthMethod: 'POST', // gotcha #4: PingOne requires POST; the AgentCore vendor may silently send client_secret_basic
  scopes: ['openid', 'profile', 'orders.read'],
};
export const CREDENTIAL_PROVIDER = {
  name: 'apd-pingone-provider',
  type: 'PingOneOauth2',
  oauth2Flow: 'USER_FEDERATION',
  callbackUrl: CALLBACK_URL, // gotcha #3: this callback URL and the PingOne app's redirect URI must match EXACTLY
};

// The pre-registered session table (gotcha #13): AgentCore looks the callback up by the sessionUri, not by a runtime session id.
export const PRE_REGISTERED = [{ sessionId: RUNTIME_SESSION_ID, sessionUri: SESSION_URI, createdAt: LAB_NOW - 600 }];

const base = () => ({
  iss: PINGONE_ISSUER,
  sub: 'user-1001',
  aud: '{{castClientId}}',
  client_id: '{{castClientId}}',
  scope: 'openid profile orders.read',
  iat: LAB_NOW - 60,
  exp: LAB_NOW + 540,
});

const token = (claims) => ({ header: { alg: 'RS256', kid: 'mock-key-1', typ: 'at+jwt' }, claims, signature: '<MOCK-SIGNATURE: not a real signature>' });

// Steps of one run, in the order they execute. Each scenario overrides one step's input to break it.
export const STEPS = [
  { id: 'authorize', label: 'Agent asks AgentCore Identity for a user token', detail: 'The runtime calls GetResourceOauth2Token for the PingOne credential provider. AgentCore starts an authorization-code flow at PingOne.' },
  { id: 'pi-flow', label: 'The human signs in (pi.flow)', detail: 'PingOne renders the sign-in form in an iframe (pi.flow): no redirect login fallback (rulebook rule 16).' },
  { id: 'callback', label: 'PingOne redirects to the callback with a code', detail: `The redirect goes to the credential provider's callbackUrl. The lab looks the session up in its pre-registered table by sessionUri.` },
  { id: 'exchange', label: 'AgentCore exchanges the code for a token', detail: `AgentCore authenticates to PingOne's token endpoint with token_endpoint_auth_method=${PINGONE_APP.tokenEndpointAuthMethod} and swaps the code for an access token.` },
  { id: 'runtime', label: 'The token reaches the agent invocation', detail: 'The agent calls a downstream API with the token. The API sees sub=user-1001: the human, not the agent client.' },
];

// The scenarios. `breakAt` names the step whose input is wrong; everything before it passes.
export const THREE_LO_SCENARIOS = [
  { id: 'allowed', title: 'Allowed: the human signs in and the token carries their sub', expected: 'allow', code: null, breakAt: null, lesson: 'Every step lines up: the callback URL matches, the session is pre-registered by sessionUri, PingOne accepts POST auth, and the returned token\'s sub is the human who signed in.', user: { name: 'Alex Rivera', sub: 'user-1001' }, idToken: token(base()) },
  { id: 'callback-mismatch', title: 'Denied: the callback URL does not match the PingOne app', expected: 'deny', code: 'redirect_uri_mismatch', breakAt: 'callback-match', lesson: 'Two callback URLs exist: the PingOne app\'s redirect URI and the credential provider\'s callbackUrl. They must match EXACTLY (scheme, host, port, path). One extra trailing slash is a mismatch, and the flow dies before a code exists.', detail: 'The credential provider\'s callbackUrl is https://app.{{castHost}}.example/auth/callback/ but the PingOne app registered https://app.{{castHost}}.example/auth/callback (no trailing slash).' },
  { id: 'session-not-preregistered', title: 'Denied: the session was never pre-registered', expected: 'deny', code: 'session_not_found', breakAt: 'session-preregistered', lesson: 'The callback lookup is keyed on the sessionUri, not on the runtime session id. A session id that was registered under its id instead of its sessionUri is never found.', detail: 'The runtime created session rt-abc123 and registered it, but the callback arrives carrying the sessionUri, so the lookup misses.' },
  { id: 'basic-auth', title: 'Denied: the vendor sent client_secret_basic, PingOne wants POST', expected: 'deny', code: 'invalid_client', breakAt: 'token-auth-method', lesson: 'The PingOneOauth2 vendor may silently fall back to HTTP Basic auth at the token endpoint. A PingOne worker app that requires POST answers 401 invalid_client, which looks like a bad secret but is an auth-method mismatch.', detail: 'The token request arrived with the Basic auth scheme in its Authorization header; the PingOne app requires token_endpoint_auth_method=POST.' },
  { id: 'iam-missing', title: 'Denied: the runtime role cannot read the token', expected: 'deny', code: 'access_denied', breakAt: 'iam-get-token', lesson: 'GetResourceOauth2Token needs the workload-identity-directory ARN in the runtime role\'s policy. Without it AgentCore answers AccessDeniedException before the flow even starts: the human is never asked to sign in.', detail: 'The runtime role\'s policy lacks bedrock-agentcore:GetResourceOauth2Token on the workload identity directory ARN.' },
  { id: 'expired-code', title: 'Denied: the authorization code expired', expected: 'deny', code: 'invalid_grant', breakAt: 'code-fresh', lesson: 'A code lives for about a minute (the lab uses sixty seconds). If the exchange runs after that, PingOne answers invalid_grant and the whole sign-in has to happen again.', detail: 'The code was issued at LAB_NOW-300 and is past its lifetime.' },
  { id: 'no-user-context', title: 'Allowed but anonymous: the token names no human', expected: 'deny', code: 'no_user_context', breakAt: 'per-invocation-user', lesson: 'A pre-registration done once at deploy time (not per invocation) gives every caller the same token as the demo user, not the caller. Registering per invocation is what makes sub the actual human.', detail: 'The token\'s sub is the deploy-time registration user, not the human who invoked the agent this time.' },
];

// Which claim each row of the returned token comes from, and how well we know it. Tags are CLAIM_TAGS keys.
export const THREE_LO_CLAIM_ROWS = [
  { claim: 'sub', tag: 'measured', note: 'The human who signed in: the whole point of USER_FEDERATION. Gotcha: a deploy-time-only pre-registration gives every caller the same sub.' },
  { claim: 'aud', tag: 'measured', note: 'The PingOne worker app\'s client id.' },
  { claim: 'scope', tag: 'measured', note: 'What the credential provider asks for; the app must grant every one of them.' },
  { claim: 'iss', tag: 'measured', note: 'The PingOne environment\'s authorization server.' },
  { claim: 'client_id', tag: 'measured', note: 'The worker app the exchange authenticated as.' },
  { claim: 'iat / exp', tag: 'invented', note: 'The lab clock.' },
  { claim: 'signature', tag: 'invented', note: 'A stand-in. The lab does not hold signing keys.' },
];

// Facts, each tagged (CLAIM_TAGS). Sources name where each came from.
export const THREE_LO_FACTS = [
  { id: 'two-callbacks', tag: 'measured', text: 'Two callback URLs must match exactly: the PingOne app\'s redirect URI and the AgentCore credential provider\'s callbackUrl. Getting this wrong ends as "authorizationCode is null" after a login that LOOKED successful.', source: 'bedrock-agentcore-pingone gotcha #3, from the Ridgeline build' },
  { id: 'post-auth', tag: 'measured', text: 'A PingOne worker app with token_endpoint_auth_method=POST answers 401 invalid_client when a client sends HTTP Basic. The AgentCore PingOneOauth2 vendor may send Basic without saying so.', source: 'gotcha #4, from the Ridgeline build' },
  { id: 'session-uri', tag: 'measured', text: 'The pre-registration table is keyed on sessionUri, not on the runtime session id. Registering by id makes every callback lookup miss.', source: 'gotcha #13, from the Ridgeline build' },
  { id: 'session-id-length', tag: 'measured', text: 'A runtime session id must be at least 33 characters or AgentCore rejects it.', source: 'gotcha #26, from the Ridgeline build' },
  { id: 'iam-directory-arn', tag: 'measured', text: 'GetResourceOauth2Token fails with AccessDeniedException when the runtime role\'s policy omits the workload-identity-directory ARN.', source: 'gotcha #18, from the Ridgeline build' },
  { id: 'no-direct-call', tag: 'invented', text: 'Everything that decides a verdict here is the lab\'s own model: the step order, the codes, the sixty-second code lifetime, the user store. No real AgentCore account or PingOne environment was called.', source: 'this lab' },
];

export const THREE_LO_TALK = { id: 'three-lo', title: 'USER_FEDERATION (3LO)', say: 'The agent on AgentCore Runtime starts a real PingOne login: pi.flow sign-in, a code to the callback, an exchange, and a token whose sub is the human. Four shapes decide whether it works: the two callback URLs must match exactly, the session must be pre-registered by its sessionUri, the token-endpoint auth method must be POST, and the runtime role must hold GetResourceOauth2Token on the workload identity directory. Walk the seven scenarios and watch which step decides each one. Everything is the lab\'s own mock of shapes we measured on a real build.' };
