import test from 'node:test';
import assert from 'node:assert/strict';
import { realEngineConfigured, realM2m } from '../src/realEngine.js';

test('realEngineConfigured needs the engine flag plus AWS creds, workload name and provider name', () => {
  assert.equal(realEngineConfigured({}), false);
  assert.equal(realEngineConfigured({ APD_REAL_ENGINE: '1' }), false);
  assert.equal(realEngineConfigured({ APD_REAL_ENGINE: '1', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's', AWS_REGION: 'r', APD_REAL_WORKLOAD_NAME: 'w', APD_REAL_PROVIDER_NAME: 'p', APD_REAL_RETURN_URL: 'https://x/' }), true);
});

test('realM2m refuses to run without its settings, and never half-configures', async () => {
  await assert.rejects(() => realM2m({}, {}, {}), /not configured/);
});

test('realM2m decodes claims and never leaks the settings values', async () => {
  // A fake fetch: the WAT call, then the token call. The JWT payload claims are what the lab shows.
  const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, path: new URL(url).pathname, headers: init.headers, body: JSON.parse(init.body) });
    if (new URL(url).pathname === '/identities/GetWorkloadAccessToken') {
      return { ok: true, text: async () => JSON.stringify({ workloadAccessToken: 'real-wat-opaque' }) };
    }
    return { ok: true, text: async () => JSON.stringify({ accessToken: jwt({ client_id: 'cid', aud: ['agentcore-lab-api'], scope: 'orders:read' }), expiresIn: 3600 }) };
  };
  const cfg = { APD_REAL_WORKLOAD_NAME: 'wl', APD_REAL_PROVIDER_NAME: 'prov', AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AK-secret-ish', AWS_SECRET_ACCESS_KEY: 'SK', AWS_SESSION_TOKEN: 'ST' };
  const origFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    const out = await realM2m({ scope: 'orders:read' }, {}, cfg);
    assert.equal(out.ok, true);
    assert.equal(out.claims.aud[0], 'agentcore-lab-api');
    assert.equal(out.claims.scope, 'orders:read');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.workloadName, 'wl');
    assert.equal(calls[1].body.resourceCredentialProviderName, 'prov');
    assert.equal(calls[1].body.workloadIdentityToken, 'real-wat-opaque');
    assert.equal(calls[1].path, '/identities/oauth2/token');
    assert.equal(calls[1].headers['x-amz-security-token'], 'ST', 'the session token signs the request');
    // the auth header is derived, not the raw secret
    assert.match(calls[1].headers.Authorization, /^AWS4-HMAC-SHA256 /);
    // the response never contains the secret key material
    assert.equal(JSON.stringify(out).includes('SK'), false);
  } finally { globalThis.fetch = origFetch; }
});

test('realM2m surfaces an AgentCore error as a readable failure, not a crash', async () => {
  const fakeFetch = async () => ({ ok: false, status: 403, text: async () => '{"message":"nope"}' });
  const origFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    await assert.rejects(() => realM2m({ scope: 'orders:read' }, {}, { APD_REAL_WORKLOAD_NAME: 'wl', APD_REAL_PROVIDER_NAME: 'prov', AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's' }), /HTTP 403/);
  } finally { globalThis.fetch = origFetch; }
});
