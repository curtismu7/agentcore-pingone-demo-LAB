# Changelog

## Moved to the -LAB standard (2026-11-01)

- New clean repo `gateway-claims-LAB` (one commit, no old history), taken from the main branch of the older private repo. The older branch `feat/h2-2026-release-updates` held no unmerged work (its content was already on main).
- New tab "v1.261029 + v1.261030": registry facts, nine readings of the two newer images and the five 2026-11-02 release features not yet measured. All UNVERIFIED, text only (`latestData.js`, `GET /api/latest`).
- Standard: the shared stylesheet is vendored and the app CSS is on tokens; a Mock | Live toggle in the header on every page (Live is refused with a message, there is no Live engine); settings from the one shared file with the single key `APD_MODE`; netguard also guards UDP connect; run buttons use aria-disabled and keep focus; presenter mode ignores modifier keys; the diagram uses the shared diagram controls pattern.
- Removed: the SE k8s manifests and deploy script, the hosted banner and switches, the per-app `.env` loader and `.env.example`, the old diagram components and theme tokens file.
- CI runs on GitHub-hosted runners with the forbidden-strings and gitleaks jobs; Node 26 only.

## Credential masking on the original endpoints (2026-11-01)

- Every JSON answer of every endpoint now passes through the response mask (`server/src/app.js`, `mask.js`), not only the release tabs.
- `POST /api/evaluate` with a custom token and rule: claim names and values, and the checks that quote them, are masked when credential-shaped (`maskTypedDeep`); ordinary input comes back exactly as before. The messages no longer name a claim key (`a value is longer than 512`), and a value quoted inside a check message is masked before it is quoted.
- `POST /api/scope-gate/evaluate`: a scope that looks like a credential is refused with `400 credential_like` (after the size limits, which still answer `too_long` / `too_many`); ordinary scopes are unchanged.
- Detectors: the JSON-key form also matches backslash-escaped quotes. Two fixed lab texts were reworded so the mask leaves them alone (the claim gate's token label, one diagram step).
- The server tests run with `--test-concurrency=2`: with many test files each starting a server, a machine under heavy load hit the HTTP client's 10 s connect timeout.
- Tests: `masking-existing.test.js` sweeps every field, name, query, path, header and unknown key of every original endpoint; ordinary input and every fixed lab text are proven unchanged.

## H2 2026 release updates (2026-10-31)

- New tabs "On-behalf-of" (slide 48) and "AgentCore console" (slide 45): Ping release claims, UNVERIFIED on our tenant, each claim tagged per field (deck claim, console swagger name, lab reading, lab-invented, measured). Mock only (this app has no Live engine). Pure engines `server/src/obo.js` and `consoleLab.js`, routes in `releaseRoutes.js`, Mock walkthrough tables generated from the engine (`npm run mock-table`, drift and HTTP-parity tests), a third diagram (`obo`), talk-track entries with "Why it matters (Ping claims)", content-pack cards and terms.
- Render guard: an error boundary around every tab (keyed by tab and vertical) so a tab that cannot be drawn never blanks the page.
- Typed text on the new endpoints: credential-looking text is refused and never echoed (NFKC, hidden characters deleted, percent-decoding three rounds, JSON keys, glued assignments, mask before truncation); fixed JSON 404 and error handler for every path and method; credential-looking workspace ids are refused (400).
- Rename check: the Federated Identity rename does not apply here (no "Non-Human Identity" text in this repo).

## v1.261028 AgentCore governance (2026-10-28)

- New tab "v1.261028 AgentCore": capability tables read from the binary diff, a runtime-bypass check and a gateway-caller-class check (pure engines in `server/src/agentcoreGov.js`, data in `agentcoreData.js`), `GET /api/agentcore`, `POST /api/agentcore/evaluate`, talk-track entry, 6 server tests and 3 web tests. Everything INFERRED; the real rules were not observed.

## v1.261027 scope gates (2026-10-28)

- New tab "v1.261027 scope gates": Cedar scope gate (Active vs candidate), PingFederate resource parameter trap, RequiredClaims scope tiers. Pure engines in `server/src/scopeGate.js`, data in `scopeData.js`, `GET /api/scope-gate`, `POST /api/scope-gate/evaluate` (scenario id plus optional own scope, bounded), a second diagram-studio/1 diagram (`scope-gate`), talk-track entry, 6 server tests and 4 web tests.

## 0.1.0 (unreleased)
- Step 1 (core, server and data), scaffolded from a sibling demo scaffold: pure `evaluateClaims` (nested dotted-path matching, flatten, bounded input), five claim-gate scenarios as `{{token}}` data in three vertical packs, AgentCore gateway posture mock (shape only), claim-gate diagram as diagram-studio/1 data, workspace-scoped evaluations and Reset, doctor, content pack, k8s manifests (not deployed). The web UI is step 2 (a placeholder page for now).
- Ports 5150-5199.
- Step 2: web UI (claim gate, posture, diagram, talk track, presenter mode), W3C traceparent on every mock hop, talk track as data, claim-gate diagram spacing.
