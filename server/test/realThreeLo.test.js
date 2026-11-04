import test from 'node:test';
import assert from 'node:assert/strict';
import { createPending, realThreeLoConfigured, realThreeLoStart, realThreeLoComplete } from '../src/realThreeLo.js';

test('realThreeLoConfigured needs the engine settings plus the return URL', () => {
  assert.equal(realThreeLoConfigured({}), false);
  assert.equal(realThreeLoConfigured({ APD_REAL_ENGINE: '1', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's', AWS_REGION: 'r', APD_REAL_WORKLOAD_NAME: 'w', APD_REAL_PROVIDER_NAME: 'p' }), false, 'return URL missing');
  assert.equal(realThreeLoConfigured({ APD_REAL_ENGINE: '1', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's', AWS_REGION: 'r', APD_REAL_WORKLOAD_NAME: 'w', APD_REAL_PROVIDER_NAME: 'p', APD_REAL_RETURN_URL: 'https://x/cb' }), true);
});

test('realThreeLoStart refuses a hostile userId, then runs the measured sequence', async () => {
  await assert.rejects(() => realThreeLoStart({ scope: 'orders:read', userId: '../etc' }), /userId required/);
  await assert.rejects(() => realThreeLoStart({ scope: 'orders:read', userId: 'x'.repeat(65) }), /userId required/);
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    if (new URL(url).pathname === '/identities/GetWorkloadAccessTokenForUserId') {
      return { ok: true, text: async () => JSON.stringify({ workloadAccessToken: 'user-bound-wat' }) };
    }
    return { ok: true, text: async () => JSON.stringify({ authorizationUrl: 'https://auth.example/authorize?request_uri=urn:x', sessionUri: 'urn:ietf:params:oauth:request_uri:abc' }) };
  };
  const orig = globalThis.fetch; globalThis.fetch = fakeFetch;
  try {
    const out = await realThreeLoStart({ scope: 'orders:read', userId: 'demoUser' }, {}, { APD_REAL_WORKLOAD_NAME: 'wl', APD_REAL_PROVIDER_NAME: 'prov', APD_REAL_RETURN_URL: 'https://x/cb', AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's' });
    assert.equal(out.ok, true);
    assert.match(out.authorizationUrl, /^https:\/\/auth\.example/);
    assert.match(out.sessionUri, /^urn:ietf:params:oauth:request_uri:/);
    assert.equal(calls[0].body.userId, 'demoUser', 'the WAT is user-bound (the measured 3LO key)');
    assert.equal(calls[1].body.oauth2Flow, 'USER_FEDERATION');
    assert.equal(calls[1].body.forceAuthentication, true);
    assert.equal(calls[1].body.resourceOauth2ReturnUrl, 'https://x/cb');
  } finally { globalThis.fetch = orig; }
});

test('realThreeLoComplete: unknown sessionUri is refused (gotcha 13), known one binds and fetches', async () => {
  const pending = createPending();
  const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    if (new URL(url).pathname === '/identities/CompleteResourceTokenAuth') return { ok: true, text: async () => '{}' };
    return { ok: true, text: async () => JSON.stringify({ accessToken: jwt({ sub: 'human-sub', aud: ['agentcore-lab-api'], scope: 'orders:read' }) }) };
  };
  const orig = globalThis.fetch; globalThis.fetch = fakeFetch;
  try {
    const miss = await realThreeLoComplete({ sessionUri: 'urn:unknown' }, pending);
    assert.equal(miss.ok, false);
    assert.match(miss.error, /gotcha 13|pre-registered/);
    pending.set('urn:known', { userId: 'demoUser', scope: 'orders:read', wat: 'user-bound-wat' });
    const out = await realThreeLoComplete({ sessionUri: 'urn:known' }, pending);
    assert.equal(out.ok, true);
    assert.equal(out.claims.sub, 'human-sub', 'the token sub is the human, not the agent client_id');
    assert.equal(calls[0].body.sessionUri, 'urn:known');
    assert.deepEqual(calls[0].body.userIdentifier, { userId: 'demoUser' });
    assert.equal(calls[1].body.sessionUri, 'urn:known');
    assert.equal(calls[1].body.forceAuthentication, false);
    assert.equal(pending.size(), 0, 'the pending entry is consumed');
  } finally { globalThis.fetch = orig; }
});

test('createPending is bounded', () => {
  const p = createPending(3);
  for (let i = 0; i < 5; i++) p.set(`k${i}`, { userId: 'u' });
  assert.equal(p.size(), 3, 'oldest dropped');
  assert.equal(p.get('k0'), undefined);
  assert.equal(p.get('k4').userId, 'u');
});
