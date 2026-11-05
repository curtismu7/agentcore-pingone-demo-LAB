# AgentCore PingOne LAB

An AI agent on AWS Bedrock AgentCore Runtime whose identity comes from PingOne, shown in mock only: the M2M flow (the agent's own token), the USER_FEDERATION flow (3LO: a real human login through the agent), and downstream on-behalf-of delegation.

Tier: Demo
Repo: https://github.com/curtismu7/agentcore-pingone-demo-LAB
Catalog: D114 (assigned by the owner, 2026-11-04)

**Everything here is simulated.** Nothing calls a real AgentCore account, PingOne environment, AWS API or tenant, and nothing leaves your machine. Where a shape comes from a real build we name the source; everything else is labelled lab-invented or lab reading.

## What is simulated

**Mock mode (default).** Everything runs offline in one process. Tokens are mock-issued by this app and shown raw for education; the step order, error codes and check names are the lab's own model. Every host ends in `.example`, and a netguard blocks outbound connections (fetch, sockets, DNS, UDP send and connect) with a self-test and a test that asserts zero attempts. It needs no tenant and no credentials.

**Real mode: built.** The header has a Mock | Real toggle on every page (rule 19: runtime switch, `POST /api/mode`, `GET /api/info` carries `realAvailable`). When the owner configures the Real settings (docs/real-mode.md), the Real tab mints a live PingOne token through AWS AgentCore Identity (M2M) and decodes it; without them Real stays disabled and the API answers 409 with the how-to.

What it shows (tabs):

1. **M2M gate.** The agent calls AgentCore Identity with `oauth2_flow=M2M` (client_credentials): no callback URL, no polling, no pre-registration — verified on a real build. The token carries `client_id` and an object-valued `act.sub`. The downstream rule requires both to equal the registered agent. Five scenarios: allowed; denied (wrong `act.sub`); denied (no `act`); denied (`act` emitted as the text `"{}"` instead of an object — a real trap); denied (wrong `client_id`). Raw decoded token JSON (mock-issued, labelled), the rule, a flattened dotted-path view, and a custom token + rule editor (bounded input).
2. **USER_FEDERATION (3LO).** The agent starts a real human login through PingOne: pi.flow sign-in, a code to the callback, an exchange, and a token whose `sub` is the human. Seven scenarios, each breaking one of the four shapes that decide the flow: the two callback URLs must match exactly, the session must be pre-registered by `sessionUri`, the token endpoint takes POST auth (Basic gets `invalid_client`), and the runtime role must hold `GetResourceOauth2Token` on the workload identity directory. Each verdict shows the per-step check states, the error code, and the token when one is minted (including the deploy-user token of the "no user context" trap).
3. **On-behalf-of** (Ping release claim, UNVERIFIED on our tenant). The caller's token is exchanged (RFC 8693) for one minted for the backend; `act` names the caller and an earlier `act` nests beneath it; 13 scenarios, each refusal says which check decided; the backend and the requested scope are editable.
4. **Diagram** (ReactFlow, drawn from diagram-studio/1 data loaded by name: M2M gate, USER_FEDERATION, on-behalf-of; movable boxes, Simulate, speed control, Reset restores box positions).
5. **Talk track** (generated from data, also in `docs/talk-track.md`). Presenter mode (`P`, `Esc` leaves; Cmd/Ctrl/Alt+P is ignored) keeps the simulation banner and shows the matching entries.

Three vertical packs (retail, health, finance) change every name. Every row carries a tag: deck claim, console swagger name (schema only), lab reading, lab-invented, or measured (our note).

### Sources and status of claims

- The M2M call shape (`oauth2_flow="M2M"` returns `accessToken` directly, no callback) and the USER_FEDERATION gotchas (the two-callback exact match, POST token-endpoint auth, the `sessionUri`-keyed pre-registration, the 33-character session id minimum, the workload-identity-directory ARN in the runtime role) are `measured` (our note): they come from the owner's verified AgentCore + PingOne build (bedrock-agentcore SDK 1.21.0, 2026-08-12). Values here are invented.
- The `act` object trap and the RequiredClaims `client_id` + `act.sub` pin come from a verified working configuration of the PingFederate token recipe (owner notes, verified live 2026-10-26 on gateway v1.261024).
- **UNVERIFIED / lab-invented:** the step order and check names in the 3LO tab, the sixty-second code lifetime, the user store, the downstream rule, the exchange checks and codes, every status code, and the keyed-hash stand-in signature.
- On-behalf-of is a Ping release claim (deck "ID4AI Workforce - H2 2026", slide 48), UNVERIFIED on our tenant; the OBO tab keeps its own tagging.
- Typed text on every endpoint is masked or refused if it looks like a credential. Masking is a heuristic: a short random secret with no keyword before it can be missed, so do not type a real one.

## Run it

```bash
npm ci
npm start            # http://127.0.0.1:7601 (loopback only)
npm test             # server (node --test) + web (vitest) + script tests
npm run doctor       # preflight checks, same ones /api/health reports
node scripts/reset.mjs [base-url]   # clear one workspace
npm run talk-track   # regenerate docs/talk-track.md from the data
npm run content-pack # regenerate + validate content-pack.json
```

Docker (OrbStack; publishes `127.0.0.1` only):

```bash
HOST_PORT=7601 docker compose --env-file ~/Development/.env up --build -d  (all settings, including the Real-mode ones, come from the shared ~/Development/.env; this repo has no .env)
```

Reached through the shared lab proxy: https://local.ping-devops.com:8443/agentcore-pingone/ (the cookie routes the SPA to this lab; the loopback URL above always works).

## Layout

- `server/src` — the engines (claims matching, 3LO step machine, OBO exchange), the mock-issuing helpers, safety (loopback bind, Host check, same-origin writes, netguard, masking), the doctor checks, and the diagram-studio/1 loader/validator.
- `server/diagrams/*.json` — the flow diagrams as diagram-studio/1 data (validated on import; the UI never hand-builds nodes).
- `web/src` — React + Vite: the tabs, the Mock/Real toggle, presenter mode, the diagram viewer.
- `scripts/` — doctor, reset, content pack, talk track, CI-guarding repo tests.
- `docs/` — talk track, safety notes, shelf entry, content-pack schema.
