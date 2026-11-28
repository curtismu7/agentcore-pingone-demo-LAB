# Changelog

## Unreleased

- AirGuard Airlines (a fictional airline) is the default story: a fourth vertical pack, `airlines` (agent and client `passenger-chat-agent`, host `airguard`), is the default on the server and in the web picker. The retail, health and finance packs are unchanged and still selectable. The M2M gate, USER_FEDERATION and on-behalf-of tabs, the talk track, the content pack and the example config now read as AirGuard Airlines; a test sweeps the rendered airline run for the old brands (Northwind, Contoso, Fabrikam, Meridian Air).
- Diagram: arrow labels are drawn in a layer above the boxes and placed so none overlaps another label or sits on a box (the walked arrow's label turns bold and coloured and is raised); click a box and it expands in place with its details below its title: its kind, reach (boxes upstream and downstream), and the arrows in and out (each opens that box), on a card with colour that means something (blue where it is, green what it sends to, amber what reaches it). Click again, Close, the empty canvas or Reset collapses it; Copy link and `?box=<id>` open the page with a box expanded. The shared `diagram-kit` (vendored into `web/src/diagram-kit/`, pinned) does the work.

## 0.1.0 (2026-11-04)

- Verification mark in the header: the shared `VerifyMark` (vendored from AI-DEMO-Standalone `shared/verify-mark`, byte for byte, pinned) shows this lab's Verified / In progress mark from the demo shelf, beside the Shelf link in the top menu. It reads the same `GET /api/shelf` call the Shelf link makes, so it shows through the lab-proxy and nothing when the lab is opened on its own port, when the shelf has no mark for it, or when the shelf is unreachable.
- First release of `agentcore-pingone-demo-LAB`, scaffolded on the fleet's -LAB standard (copied from a sibling repo's packaging; no code imported).
- M2M gate: the agent's own PingOne token via AgentCore Identity (`oauth2_flow=M2M`, client_credentials, a verified shape) against a downstream required-claims rule; five scenarios including the `act`-emitted-as-text-`"{}"` trap.
- USER_FEDERATION (3LO): the agent starts a real human login through PingOne (pi.flow, code to callback, exchange); seven scenarios, each breaking one of the four measured shapes (exact callback match, `sessionUri` pre-registration, POST token-endpoint auth, `GetResourceOauth2Token` IAM) with per-step check states and the minted token where one exists.
- On-behalf-of: the RFC 8693 exchange engine (13 scenarios; Ping release claim, UNVERIFIED on our tenant).
- Rule 19: Mock/Real toggle in the header (`POST /api/mode`, `GET /api/info` with `realAvailable`); Real 409s with a how-to until the owner builds the live engine behind `APD_REAL_ENGINE`.
- Diagrams as diagram-studio/1 data (M2M gate, USER_FEDERATION, on-behalf-of); talk track generated from the same data the UI reads; presenter mode keeps the simulation banner.
- Safety: loopback bind, Host check, same-origin writes, netguard with self-test, credential masking on every endpoint, mock-issued tokens shown raw and labelled.
