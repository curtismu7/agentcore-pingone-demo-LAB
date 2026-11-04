// The Real 3LO engine: a real human login through PingOne, brokered by AWS AgentCore Identity.
// Measured pattern (works):
//   1. GetWorkloadAccessTokenForUserId (POST /identities/GetWorkloadAccessTokenForUserId, { workloadName, userId })
//      - USER_FEDERATION needs a USER-BOUND workload token; the plain workload token gets AccessDenied(message:null).
//   2. GetResourceOauth2Token (POST /identities/oauth2/token, oauth2Flow USER_FEDERATION, forceAuthentication true,
//      resourceOauth2ReturnUrl) -> { authorizationUrl, sessionUri } (sessionUri is AgentCore's request_uri, NOT our
//      session id - gotcha 13).
//   3. The human signs in; PingOne redirects to AgentCore's relay (registered as the PingOne app's redirect URI);
//      AgentCore then redirects to OUR callback with ?session_id=<sessionUri>.
//   4. CompleteResourceTokenAuth (POST /identities/CompleteResourceTokenAuth, { sessionUri, userIdentifier: { userId } })
//      binds the session to the user (gotcha 12: the return URL is exact-match, so the pre-registration map keyed on
//      sessionUri is the only way to carry the user).
//   5. GetResourceOauth2Token again with forceAuthentication false + sessionUri -> { accessToken } - a real PingOne
//      token whose sub is the HUMAN (not the agent's client_id).
// Zero dependencies: SigV4 with node:crypto (same as realEngine.js).
import { createHash, createHmac } from 'node:crypto';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

function sigv4Headers({ accessKey, secretKey, sessionToken, region, host, path, body, method = 'POST' }) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n` + (sessionToken ? `x-amz-security-token:${sessionToken}\n` : '');
  const signedHeaders = 'content-type;host;x-amz-date' + (sessionToken ? ';x-amz-security-token' : '');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/bedrock-agentcore/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), 'bedrock-agentcore'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-date': amzDate, 'content-type': 'application/json',
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
  };
}

export function realThreeLoConfigured(env = process.env, shared = {}) {
  const e = { ...env, ...shared };
  return Boolean(e.APD_REAL_ENGINE === '1' && e.AWS_ACCESS_KEY_ID && e.AWS_SECRET_ACCESS_KEY
    && e.APD_REAL_WORKLOAD_NAME && e.APD_REAL_PROVIDER_NAME && e.AWS_REGION && e.APD_REAL_RETURN_URL);
}

async function call({ path, payload, cfg }) {
  const host = `bedrock-agentcore.${cfg.region}.amazonaws.com`;
  const body = JSON.stringify(payload);
  const headers = sigv4Headers({ accessKey: cfg.accessKey, secretKey: cfg.secretKey, sessionToken: cfg.sessionToken, region: cfg.region, host, path, body });
  const r = await fetch(`https://${host}${path}`, { method: 'POST', headers, body });
  const text = await r.text();
  if (!r.ok) throw new Error(`AgentCore ${path} -> HTTP ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text || '{}');
}

const cfgFrom = (env, shared) => {
  const e = { ...env, ...shared };
  return {
    cfg: { region: e.AWS_REGION || 'us-east-1', accessKey: e.AWS_ACCESS_KEY_ID, secretKey: e.AWS_SECRET_ACCESS_KEY, sessionToken: e.AWS_SESSION_TOKEN },
    workloadName: e.APD_REAL_WORKLOAD_NAME, provider: e.APD_REAL_PROVIDER_NAME, returnUrl: e.APD_REAL_RETURN_URL,
  };
};

// Step 1+2: start a 3LO session. Returns { authorizationUrl, sessionUri }.
export async function realThreeLoStart({ scope = 'orders:read', userId }, env = process.env, shared = {}) {
  const { cfg, workloadName, provider, returnUrl } = cfgFrom(env, shared);
  if (!userId || typeof userId !== 'string' || userId.length > 64 || !/^[A-Za-z0-9@._-]{1,64}$/.test(userId)) throw new Error('userId required (1-64 chars of A-Za-z0-9@._-)');
  if (!workloadName || !provider || !returnUrl) throw new Error('Real 3LO not configured: APD_REAL_WORKLOAD_NAME, APD_REAL_PROVIDER_NAME and APD_REAL_RETURN_URL are required');
  const wat = await call({ path: '/identities/GetWorkloadAccessTokenForUserId', payload: { workloadName, userId }, cfg });
  const start = await call({
    path: '/identities/oauth2/token',
    payload: { resourceCredentialProviderName: provider, oauth2Flow: 'USER_FEDERATION', scopes: [scope], workloadIdentityToken: wat.workloadAccessToken, resourceOauth2ReturnUrl: returnUrl, forceAuthentication: true },
    cfg,
  });
  if (!start.authorizationUrl || !start.sessionUri) return { ok: false, error: 'AgentCore returned no authorizationUrl/sessionUri', provider };
  return { ok: true, authorizationUrl: start.authorizationUrl, sessionUri: start.sessionUri, provider, scope, userId, wat: wat.workloadAccessToken };
}

// Step 4: the callback hit. Binds sessionUri -> userId, then step 5 fetches the token.
export async function realThreeLoComplete({ sessionUri }, pending, env = process.env, shared = {}) {
  const { cfg, provider, returnUrl } = cfgFrom(env, shared);
  const pre = pending.get(sessionUri);
  if (!pre) return { ok: false, error: 'unknown session: no pre-registered user for this sessionUri (gotcha 13: the key is the sessionUri AgentCore gave, not our own id)' };
  pending.delete(sessionUri);
  await call({ path: '/identities/CompleteResourceTokenAuth', payload: { sessionUri, userIdentifier: { userId: pre.userId } }, cfg });
  const fin = await call({
    path: '/identities/oauth2/token',
    payload: { resourceCredentialProviderName: provider, oauth2Flow: 'USER_FEDERATION', scopes: [pre.scope], workloadIdentityToken: pre.wat, resourceOauth2ReturnUrl: returnUrl, sessionUri, forceAuthentication: false },
    cfg,
  });
  const token = fin.accessToken;
  if (!token) return { ok: false, error: 'AgentCore returned no accessToken after CompleteResourceTokenAuth', provider };
  const [, p] = token.split('.');
  const claims = JSON.parse(Buffer.from(p + '='.repeat((4 - (p.length % 4)) % 4), 'base64url').toString('utf8'));
  return { ok: true, engine: 'real', flow: 'USER_FEDERATION', provider, scope: pre.scope, userId: pre.userId, claims, tokenHead: `${token.slice(0, 24)}...`, expiresIn: fin.expiresIn };
}

// In-memory pre-registration map: sessionUri -> { userId, scope, wat }. Tiny (one presenter demo), bounded.
export function createPending(max = 16) {
  const map = new Map();
  return {
    set: (k, v) => { if (map.size >= max) map.delete(map.keys().next().value); map.set(k, v); },
    get: (k) => map.get(k),
    delete: (k) => map.delete(k),
    size: () => map.size,
  };
}
