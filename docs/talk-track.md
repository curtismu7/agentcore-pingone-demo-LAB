# Talk track

<!-- Generated from server/src/claimsData.js by `npm run talk-track`. Do not edit by hand. -->

## Say first

Everything here is simulated. The tokens, the rules and the step data are invented by this app; only their shape follows what we measured on a real AgentCore + PingOne build.

## M2M: the agent's own token

The agent asks AgentCore Identity for a PingOne token with oauth2_flow=M2M: client_credentials, no human, no browser, the call returns the accessToken directly. The token carries client_id and an act object with sub = the agent. The downstream rule requires both to equal the registered agent. Walk the five scenarios: allowed, wrong act.sub, no act, act as the text "{}", wrong client_id.

## The "{}" trap

The mapping produced the string "{}" instead of an object, so act.sub does not exist. The fix is the mapping expression (it must produce an object), not the rule.

## USER_FEDERATION (3LO)

The agent on AgentCore Runtime starts a real PingOne login: pi.flow sign-in, a code to the callback, an exchange, and a token whose sub is the human. Four shapes decide whether it works: the two callback URLs must match exactly, the session must be pre-registered by its sessionUri, the token-endpoint auth method must be POST, and the runtime role must hold GetResourceOauth2Token on the workload identity directory. Walk the seven scenarios and watch which step decides each one. Everything is the lab's own mock of shapes we measured on a real build.

## M2M or 3LO: when to pick which

M2M when the agent acts as itself: the token names the agent client and nothing else. USER_FEDERATION when a human must be accountable: the token carries that human's sub, and downstream delegation via RFC 8693 puts the human in sub and the agent in act.sub. The on-behalf-of tab shows that exchange.

## On-behalf-of (Ping release claim)

Ping release claim, UNVERIFIED on our tenant. The deck says the gateway swaps the caller's verified token for one minted for the downstream MCP server (RFC 8693), so the backend validates a token issued to it instead of trusting a shared service account, and the act claim keeps who called. Here that is the lab's own model: pick a scenario and watch which check decides, then change the backend or the requested scope. Every row says whether it is a deck claim, a swagger field name, our reading, our invention or something we measured.

## Why it matters: Intent, Purpose, Behaviour (slide 48; on-behalf-of is one of its six rows) (Ping claims)

Per Ping's deck (slide 48), UNVERIFIED on our tenant. Challenge: A tool name and arguments cannot say what was asked for, whether the agent was ever meant to do it, or whether it normally behaves this way. Policy built on the request alone cannot tell misuse from an agent doing its job. Technical value: Three separable signals: deterministic intent patterns and purpose declarations refuse hard; learned behaviour baselines drive alerts and approval. On-behalf-of gives the backend a token issued to it, with the original caller named in act. Business value: The enforceable declaration "this agent exists to reconcile invoices" unblocks unattended agents in processes that could not otherwise approve them.

## What we do not claim

The step order, the error codes, the sixty-second code lifetime and the user store in the USER_FEDERATION tab are this lab's own model. What we measured on the real build are the four shapes: the two-callback match, POST auth at the token endpoint, the sessionUri-keyed pre-registration, and the workload-identity-directory ARN in the runtime role.

## Close

Reset clears your workspace. Nothing was sent anywhere. Mock only: this app has no Live engine (it refuses APD_MODE=live). Nothing here calls a gateway, an issuer or a cloud account.

## The five scenarios

1. **Allowed: act.sub matches.** client_id and act.sub both equal the registered agent, so the rule passes.
2. **Denied: act.sub is a different agent.** The token is valid and signed, but it acts for another agent. The nested claim decides, not the signature.
3. **Denied: no act claim at all.** Without act there is no act.sub to match. A token that proves only a client is not enough for this rule.
4. **Denied: act emitted as the text "{}".** The real trap: the token mapping produced the text "{}" instead of an object, so act.sub does not exist. Fix the mapping expression, not the rule.
5. **Denied: wrong client_id.** act.sub is right but client_id names another client. Both required claims must match.

## The USER_FEDERATION (3LO) scenarios

1. **Allowed: the human signs in and the token carries their sub.** Every step lines up: the callback URL matches, the session is pre-registered by sessionUri, PingOne accepts POST auth, and the returned token's sub is the human who signed in.
2. **Denied: the callback URL does not match the PingOne app.** Two callback URLs exist: the PingOne app's redirect URI and the credential provider's callbackUrl. They must match EXACTLY (scheme, host, port, path). One extra trailing slash is a mismatch, and the flow dies before a code exists.
3. **Denied: the session was never pre-registered.** The callback lookup is keyed on the sessionUri, not on the runtime session id. A session id that was registered under its id instead of its sessionUri is never found.
4. **Denied: the vendor sent client_secret_basic, PingOne wants POST.** The PingOneOauth2 vendor may silently fall back to HTTP Basic auth at the token endpoint. A PingOne worker app that requires POST answers 401 invalid_client, which looks like a bad secret but is an auth-method mismatch.
5. **Denied: the runtime role cannot read the token.** GetResourceOauth2Token needs the workload-identity-directory ARN in the runtime role's policy. Without it AgentCore answers AccessDeniedException before the flow even starts: the human is never asked to sign in.
6. **Denied: the authorization code expired.** A code lives for about a minute (the lab uses sixty seconds). If the exchange runs after that, PingOne answers invalid_grant and the whole sign-in has to happen again.
7. **Allowed but anonymous: the token names no human.** A pre-registration done once at deploy time (not per invocation) gives every caller the same token as the demo user, not the caller. Registering per invocation is what makes sub the actual human.

## The on-behalf-of scenarios (Ping release claim, UNVERIFIED on our tenant)

1. **Allowed: a token minted for the backend.** The caller token was issued to the gateway, so the gateway exchanges it. The backend gets a new token. Its aud is the backend, its sub is still the user, and act names the agent that called.
2. **Allowed: the act claim chain grows.** The caller token already carries an act (a planner agent acted first). The exchange puts the current caller outermost and nests the earlier one beneath it, one level per hop (RFC 8693 section 4.1).
3. **Denied: the caller token was not issued to the gateway.** The gateway only exchanges tokens issued to it. A token minted for some other service is refused before the issuer is asked.
4. **Denied: the caller token has expired.** The lab clock is past exp. An expired token is not exchanged.
5. **Denied: a claim was changed after signing.** The scope claim was widened after the token was signed, so the signature the lab recomputes does not match. The lab's signature is a keyed hash, a stand-in for a real one.
6. **Denied: the caller token came from an issuer the gateway does not trust.** Only the configured issuer's tokens are exchanged.
7. **Denied: the caller token names no user.** On behalf of whom? Without a sub there is nobody to carry to the backend, so the lab refuses.
8. **Denied: the same caller token is presented twice.** The first exchange works; the second use of the same jti is refused. Replay protection is a lab-invented check, not a claim about the real gateway.
9. **Denied: the act chain is already as deep as the lab allows.** The exchange would add one more level. The lab caps the chain at three actors.
10. **Denied: no Resource is configured.** Resource becomes the exchanged token's aud (the audience the backend validates). Left blank there is no audience to mint for.
11. **Denied: the Resource is not a backend the gateway knows.** A resource indicator with no exchange config behind it is refused.
12. **Denied: the exchange asks for more scope than the caller holds.** An exchange may narrow what the caller holds, never widen it. The caller holds orders:read and orders:write; admin:all is not among them.
13. **Denied: the scope is not one this backend offers.** The caller holds orders:write, but the reports backend offers only reports:read, so a token for it cannot carry orders:write.
