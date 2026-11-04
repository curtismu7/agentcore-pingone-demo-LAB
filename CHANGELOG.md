# Changelog

## 0.1.0 (2026-11-04)

- First release of `agentcore-pingone-demo-LAB`, scaffolded on the fleet's -LAB standard (copied from a sibling repo's packaging; no code imported).
- M2M gate: the agent's own PingOne token via AgentCore Identity (`oauth2_flow=M2M`, client_credentials, a verified shape) against a downstream required-claims rule; five scenarios including the `act`-emitted-as-text-`"{}"` trap.
- USER_FEDERATION (3LO): the agent starts a real human login through PingOne (pi.flow, code to callback, exchange); seven scenarios, each breaking one of the four measured shapes (exact callback match, `sessionUri` pre-registration, POST token-endpoint auth, `GetResourceOauth2Token` IAM) with per-step check states and the minted token where one exists.
- On-behalf-of: the RFC 8693 exchange engine (13 scenarios; Ping release claim, UNVERIFIED on our tenant).
- Rule 19: Mock/Real toggle in the header (`POST /api/mode`, `GET /api/info` with `realAvailable`); Real 409s with a how-to until the owner builds the live engine behind `APD_REAL_ENGINE`.
- Diagrams as diagram-studio/1 data (M2M gate, USER_FEDERATION, on-behalf-of); talk track generated from the same data the UI reads; presenter mode keeps the simulation banner.
- Safety: loopback bind, Host check, same-origin writes, netguard with self-test, credential masking on every endpoint, mock-issued tokens shown raw and labelled.
