// The Real engine: AWS AgentCore Identity -> PingOne, live. No dependencies: SigV4 with node:crypto.
// Flow (measured, works): GetWorkloadAccessToken (POST /identities/GetWorkloadAccessToken)
//   then GetResourceOauth2Token (POST /identities/oauth2/token, oauth2Flow=M2M).
// The returned token is a real PingOne access token: aud agentcore-lab-api, scope orders:read,
// sub client_id. Every value that reaches the wire is real; nothing is mocked here.
import { createHash, createHmac } from 'node:crypto';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

export function realEngineConfigured(env = process.env, shared = {}) {
  const e = { ...env, ...shared };
  return Boolean(e.APD_REAL_ENGINE === '1' && e.AWS_ACCESS_KEY_ID && e.AWS_SECRET_ACCESS_KEY
    && e.APD_REAL_WORKLOAD_NAME && e.APD_REAL_PROVIDER_NAME && e.AWS_REGION && e.APD_REAL_RETURN_URL);
}

function sigv4Headers({ accessKey, secretKey, sessionToken, region, host, path, body, method = 'POST' }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalUri = path;
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n` + (sessionToken ? `x-amz-security-token:${sessionToken}\n` : '');
  const signedHeaders = 'content-type;host;x-amz-date' + (sessionToken ? ';x-amz-security-token' : '');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/bedrock-agentcore/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${secretKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 'bedrock-agentcore');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { 'Authorization': auth, 'x-amz-date': amzDate, 'content-type': 'application/json', ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}) };
}

async function agentcoreCall({ path, payload, cfg }) {
  const host = `bedrock-agentcore.${cfg.region}.amazonaws.com`;
  const body = JSON.stringify(payload);
  const headers = sigv4Headers({ accessKey: cfg.accessKey, secretKey: cfg.secretKey, sessionToken: cfg.sessionToken, region: cfg.region, host, path, body });
  const r = await fetch(`https://${host}${path}`, { method: 'POST', headers, body });
  const text = await r.text();
  if (!r.ok) throw new Error(`AgentCore ${path} -> HTTP ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text || '{}');
}

// One real M2M run: WAT -> PingOne token via the credential provider, then decode the claims.
export async function realM2m({ scope = 'orders:read' }, env = process.env, shared = {}) {
  const e = { ...env, ...shared };
  const cfg = {
    region: e.AWS_REGION || 'us-east-1',
    accessKey: e.AWS_ACCESS_KEY_ID, secretKey: e.AWS_SECRET_ACCESS_KEY, sessionToken: e.AWS_SESSION_TOKEN,
  };
  const workloadName = e.APD_REAL_WORKLOAD_NAME;
  const provider = e.APD_REAL_PROVIDER_NAME;
  if (!workloadName || !provider) throw new Error('Real engine not configured: APD_REAL_WORKLOAD_NAME and APD_REAL_PROVIDER_NAME are required');

  const wat = await agentcoreCall({ path: '/identities/GetWorkloadAccessToken', payload: { workloadName }, cfg });
  const tokenResp = await agentcoreCall({
    path: '/identities/oauth2/token',
    payload: { resourceCredentialProviderName: provider, oauth2Flow: 'M2M', scopes: [scope], workloadIdentityToken: wat.workloadAccessToken },
    cfg,
  });
  const token = tokenResp.accessToken;
  if (!token) return { ok: false, error: 'AgentCore returned no accessToken', provider, scope };
  const [, p] = token.split('.');
  const claims = JSON.parse(Buffer.from(p + '='.repeat((4 - (p.length % 4)) % 4), 'base64url').toString('utf8'));
  return { ok: true, engine: 'real', provider, scope, claims, tokenHead: `${token.slice(0, 24)}...`, rawToken: token, expiresIn: tokenResp.expiresIn, tokenType: tokenResp.tokenType };
}
