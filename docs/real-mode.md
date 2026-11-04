# Real mode: the owner setup (one-time)

The lab's Real engine calls **AWS AgentCore Identity** and gets back a **real PingOne access token**.
This document is the exact sequence used to build it, with the values that actually worked (measured
2026-11-04, SDK 1.25.3, `us-east-1`, PingOne region `com`).

## The chain that runs

```
lab server (Node, SigV4, zero deps)
  -> POST /identities/GetWorkloadAccessToken     { workloadName }
  -> POST /identities/oauth2/token               { resourceCredentialProviderName, oauth2Flow: "M2M", scopes, workloadIdentityToken }
  <- { accessToken }   a real PingOne JWT: aud agentcore-lab-api, scope orders:read, iss auth.pingone.com
```

## 1. PingOne (tenant: the AI-DEMO2 environment)

- OIDC Web App `AgentCore PingOne LAB - Agent`
  - `tokenEndpointAuthMethod: CLIENT_SECRET_POST` (gotcha #4: silent 401 `invalid_client` if this mismatches)
  - grants: `CLIENT_CREDENTIALS` + `AUTHORIZATION_CODE`, `responseTypes: ["CODE"]`
  - client secret captured at creation (rotate via `POST /applications/{id}/secret`)
- Resource `agentcore-lab-resource`, audience **`agentcore-lab-api`**, scopes `orders:read`, `orders:write`
- Grant both scopes to the app
- Verified M2M directly: `sub` = client_id, `aud` = `agentcore-lab-api` (updates the skill's "inferred" note with measured data)

## 2. AWS (account 265988230536, profile `agent-toolkit`)

- Credential provider (control plane):
  `create-oauth2-credential-provider` name `agentcore-pingone-demo-lab`, vendor **`CustomOauth2`**
  (never `PingOneOauth2` - gotcha #4), `clientAuthenticationMethod: CLIENT_SECRET_POST`,
  `oauthDiscovery.discoveryUrl` = the env's openid-configuration URL. Capture `callbackUrl`.
- Register the provider `callbackUrl` as a Redirect URI on the PingOne app (USER_FEDERATION step; harmless for M2M-only).
- Standalone workload identity (NOT the runtime's service-linked one - those refuse
  `GetWorkloadAccessToken` from a caller): `create-workload-identity` name
  `agentcore-pingone-demo-lab-caller`.
- Optionally a Runtime agent (`AgentCorePingOneLabAgent2`) for the 3LO flow later; its execution role
  needs `bedrock-agentcore:GetWorkloadAccessToken` on the workload-identity-directory plus
  `GetResourceOauth2Token` on the token vault (gotcha #18). Inside a Runtime, the WAT arrives in the
  request context (`BedrockAgentCoreContext.get_workload_access_token()`) - never call
  `GetWorkloadAccessToken` for a service-linked identity yourself.

## 3. Lab settings (`~/Development/.env`, shared file, never committed)

```
APD_REAL_ENGINE=1
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<fresh from `aws configure export-credentials --profile agent-toolkit --format env`>
AWS_SECRET_ACCESS_KEY=<same>
AWS_SESSION_TOKEN=<same>
APD_REAL_WORKLOAD_NAME=agentcore-pingone-demo-lab-caller
APD_REAL_PROVIDER_NAME=agentcore-pingone-demo-lab
```

The federated session expires (about a day). When the Real tab starts failing with
"The security token included in the request is expired": run `aws login --profile agent-toolkit`,
then rewrite the three AWS_* lines in the shared file and `docker compose up -d --force-recreate`
in the lab directory.

## 4. What the netguard does in Real mode

Mock mode keeps the hard zero-outbound guarantee. When the Real settings are present AND
`APD_REAL_ENGINE=1`, the netguard opens exactly one host:
`bedrock-agentcore.<AWS_REGION>.amazonaws.com`. Everything else - other regions, other services,
random hosts - stays blocked and recorded. `server/test/netguard.test.js` pins this.

## 5. Real 3LO (USER_FEDERATION): the human signs in

The Real tab's second panel runs a live three-legged login. The measured pattern:

1. `GetWorkloadAccessTokenForUserId` (POST `/identities/GetWorkloadAccessTokenForUserId`,
   `{ workloadName, userId }`) - **the user-bound WAT is required**: the plain workload token
   gets `AccessDeniedException` with `message: null` on USER_FEDERATION (measured 2026-11-04).
2. `GetResourceOauth2Token` (`oauth2Flow USER_FEDERATION`, `forceAuthentication true`,
   `resourceOauth2ReturnUrl`) -> `{ authorizationUrl, sessionUri }`.
3. The human signs in (AgentCore's hosted consent page hands off to PingOne's hosted login).
4. AgentCore redirects to the lab's `/api/real/callback?session_id=<sessionUri>`.
5. `CompleteResourceTokenAuth` (`{ sessionUri, userIdentifier: { userId } }`) binds the session -
   the pre-registration map in the lab server is keyed on `sessionUri` (gotchas 12/13).
6. `GetResourceOauth2Token` again (`forceAuthentication false`, `sessionUri`) -> the token.

Verified live: the returned token's `sub` is demoUser's PingOne user id
(`1aee74ae-...`), `acr: Single_Factor`, `auth_time` the moment of sign-in - NOT the
agent's client_id. That contrast is the demo's teaching point.

**Return-URL gotcha (proxy deployments):** register the return URL WITHOUT the app's path
prefix (`https://local.ping-devops.com:8443/api/real/callback`, not
`/agentcore-pingone/api/real/callback`). The shared lab-proxy strips the prefix only on the
exact entry route; a prefixed callback path arrives at the lab un-stripped, misses the `/api`
router, and is silently answered by the SPA catch-all - the flow then fails with
"unknown session" even though the sessionUri matches. The browser carries the lab cookie, so
the un-prefixed URL routes correctly through the proxy's cookie map.

## 6. Verify (never trust the toggle alone)

```
curl -sk -X POST -H 'content-type: application/json' -H "origin: https://local.ping-devops.com:8443" \
  -H 'cookie: lab=agentcore-pingone' -d '{"scope":"orders:read"}' \
  https://local.ping-devops.com:8443/api/real/m2m
```

Decode the returned `rawToken` payload: `aud` must be `agentcore-lab-api`, `iss` the PingOne env's
`/as`, `scope` the requested scope. `sub` = the app's client_id for M2M. The UI's Real tab does this
decode for you.
