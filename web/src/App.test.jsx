import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { visible } from "./safeText";
import userEvent from "@testing-library/user-event";
import App, { BANNER_UNKNOWN } from "./App";
import { labelOffsets } from "./components/PatternDiagram";

const TOKEN = (claims) => ({ header: { alg: "RS256" }, claims, signature: "<MOCK-SIGNATURE: not a real signature>" });
const SCEN = [
  { id: "allowed", title: "Allowed: act.sub matches", expected: "allow", lesson: "Both match.", token: TOKEN({ client_id: "a", act: { sub: "a" } }) },
  { id: "act-text", title: 'Denied: act emitted as the text "{}"', expected: "deny", lesson: "The trap.", token: TOKEN({ client_id: "a", act: "{}" }) },
];
const STORY = {
  title: "t", intro: "intro text", banner: "SIMULATED, MOCK mode: a mock token", tokenLabel: "MOCK-ISSUED teaching token", verticals: ["retail", "health"],
  rule: { name: "Registered agent only (mock)", appliesTo: "Agent API", note: "n", requiredClaims: [{ path: "client_id", equals: "a" }, { path: "act.sub", equals: "a" }] },
  scenarios: SCEN, cast: { castAgentId: "a" },
  facts: [{ id: "m2m-shape", status: "measured", text: "M2M returns the accessToken directly.", source: "skill" }, { id: "x", status: "inferred", text: "The rule is ours.", source: "this lab" }],
  talkTrack: [{ id: "say-first", title: "Say first", say: "Everything is simulated." }, { id: "m2m", title: "M2M", say: "Walk the five scenarios." }, { id: "three-lo", title: "USER_FEDERATION", say: "Four shapes decide it." }, { id: "three-lo-vs-m2m", title: "When to pick which", say: "M2M for itself, 3LO for a human." }, { id: "obo", title: "On-behalf-of", say: "Ping release claim, UNVERIFIED on our tenant. Swap the token." }, { id: "why-obo", title: "Why it matters: OBO (Ping claims)", say: "Per Ping's deck, slide 48." }, { id: "unverified", title: "What we do not claim", say: "The step order is our model." }],
};
const LO_STORY = {
  title: "USER_FEDERATION title", intro: "3LO intro.", simulated: true,
  steps: [{ id: "authorize", label: "Ask for a user token", detail: "The runtime calls GetResourceOauth2Token." }, { id: "pi-flow", label: "The human signs in", detail: "pi.flow renders the form." }],
  pingoneApp: { clientId: "c", redirectUri: "https://app.example/auth/callback", tokenEndpointAuthMethod: "POST", scopes: ["openid", "orders.read"] },
  credentialProvider: { name: "apd-pingone-provider", type: "PingOneOauth2", oauth2Flow: "USER_FEDERATION", callbackUrl: "https://app.example/auth/callback" },
  preRegistered: [{ sessionId: "session-0123456789012345678901234567890", sessionUri: "https://bedrock-agentcore.example/sessions/session-0123456789012345678901234567890/oauth2/callback", createdAt: 1 }],
  claimRows: [{ claim: "sub", tag: "measured", note: "The human who signed in." }, { claim: "iat / exp", tag: "invented", note: "The lab clock." }],
  facts: [{ id: "two-callbacks", tag: "measured", text: "Two callback URLs must match exactly.", source: "gotcha #3" }, { id: "no-direct-call", tag: "invented", text: "The step order is the lab's own model.", source: "this lab" }],
  scenarios: [
    { id: "allowed", title: "Allowed: the human signs in", expected: "allow", code: null, breakAt: null, lesson: "Every step lines up." },
    { id: "callback-mismatch", title: "Denied: the callback URL does not match", expected: "deny", code: "redirect_uri_mismatch", breakAt: "callback", lesson: "They must match exactly." },
    { id: "no-user-context", title: "Denied: the token names no human", expected: "deny", code: "no_user_context", breakAt: "runtime", lesson: "Register per invocation." },
  ],
};
const loRun = (id) => {
  const allow = id === "allowed";
  const checks = [
    { id: "iam-get-token", tag: "measured", label: "The runtime role can call GetResourceOauth2Token", ok: true },
    { id: "callback-match", tag: "measured", label: "The two callback URLs match exactly", ok: allow || id === "no-user-context" ? true : false },
    { id: "session-preregistered", tag: "measured", label: "The session was pre-registered by sessionUri", ok: allow || id === "no-user-context" ? true : null },
    { id: "token-auth-method", tag: "measured", label: "The token endpoint accepted the auth method (POST)", ok: allow ? true : null },
    { id: "code-fresh", tag: "invented", label: "The authorization code is still fresh", ok: allow ? true : null },
    { id: "per-invocation-user", tag: "measured", label: "The token names the human who invoked", ok: allow ? true : id === "no-user-context" ? false : null },
  ];
  return { decision: allow ? "allow" : "deny", code: allow ? null : id === "callback-mismatch" ? "redirect_uri_mismatch" : "no_user_context", checks, failedCheck: allow ? null : id === "callback-mismatch" ? "callback-match" : "per-invocation-user",
    token: allow ? { header: { alg: "RS256" }, claims: { iss: "https://auth.pingone.example/as", sub: "user-1001", aud: "c", client_id: "c" }, signature: "sig" } : id === "no-user-context" ? { header: { alg: "RS256" }, claims: { sub: "deploy-user" }, signature: "sig" } : null,
    user: allow ? { name: "Alex Rivera", sub: "user-1001" } : null, detail: null, steps: allow ? checks.map((c) => c.id) : checks.slice(0, allow ? 6 : 2).map((c) => c.id),
    scenario: id, expected: allow ? "allow" : "deny", lesson: allow ? "Every step lines up." : id === "callback-mismatch" ? "They must match exactly." : "Register per invocation.", traceId: "a".repeat(32), traceparent: `00-${"a".repeat(32)}-0000000000000001-01` };
};
const DIAGRAM = {
  title: "M2M gate", intro: "diagram intro",
  nodes: [{ id: "agent", label: "Agent (AgentCore Runtime)", kind: "aws", x: 0, y: 0 }, { id: "api", label: "Downstream API", kind: "resource", x: 300, y: 0 }],
  steps: [{ from: "agent", to: "api", label: "Bearer token", say: "The agent presents the token." }, { from: "api", to: "agent", label: "Decision", say: "The API answers." }],
};
const hop = (n) => ({ n, from: "agent", to: "app", label: `hop ${n}`, traceparent: `00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, request: `traceparent: 00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, response: "HTTP/1.1 200 OK" });

const TAGS = { deck: "deck claim", swagger: "console swagger name (schema only)", reading: "lab reading", invented: "lab-invented", measured: "measured (our note)" };
const WHY = { slide: 48, feature: "Intent, Purpose, Behaviour", challenge: "A tool name cannot say why.", technical: "Three separable signals.", business: "Unblocks unattended agents." };
const OBO_STORY = {
  title: "On-behalf-of title", intro: "Intro.", noLive: "Mock only: this app has no Live engine (it refuses APD_MODE=live). Nothing here calls a gateway.", tags: TAGS, why: WHY, simulated: true,
  resourceChoices: ["orders", "reports", "unlisted", "none"], config: { TokenURL: "https://pf.example/as/token.oauth2", Resource: "https://mcp.example/orders/mcp", SubjectTokenType: "" },
  configRows: [{ field: "TokenURL", tag: "swagger" }, { field: "ClientSecret", tag: "swagger", note: "write-only here: the lab holds none" }, { field: "SubjectTokenType", tag: "swagger" }],
  claimRows: [{ claim: "act", tag: "deck", note: "Slide 48." }, { claim: "aud", tag: "reading", note: "Resource." }],
  facts: [{ id: "deck-obo", tag: "deck", text: "NEW: the gateway swaps the token.", source: "deck slide 48" }, { id: "x", tag: "invented", text: "The checks are ours.", source: "this lab" }],
  scenarios: [
    { id: "allowed", title: "Allowed: a token minted for the backend", expected: "allow", evidence: "reading", lesson: "The backend gets a new token." },
    { id: "expired", title: "Denied: the caller token has expired", expected: "deny", evidence: "reading", lesson: "Expired is not exchanged." },
    { id: "replay", title: "Denied: replayed", expected: "deny", evidence: "invented", lesson: "Twice." },
  ],
};
const oboRun = (id, body = {}) => {
  const deny = id !== "allowed" || body.resource === "reports";
  const checks = deny ? [{ id: "inbound_signature", ok: true, detail: "ok" }, { id: "inbound_expiry", ok: false, detail: "exp is not after the lab clock" }, { id: "resource", ok: null, detail: "not reached" }] : [{ id: "inbound_signature", ok: true, detail: "ok" }, { id: "resource", ok: true, detail: "orders" }];
  const ex = deny ? null : { header: { alg: "MOCK-HS256" }, claims: { aud: "https://mcp.example/orders/mcp", sub: "user-1001", act: { sub: "orders-agent" } }, signature: "sig" };
  return { scenario: id, request: { resource: "https://mcp.example/orders/mcp", resourceChoice: body.resource || "orders", scope: body.scope ?? "orders:read" }, inbound: { header: { alg: "MOCK-HS256" }, claims: { sub: "user-1001", aud: "https://gateway.example/mcp" }, signature: "sig" },
    result: { decision: deny ? "deny" : "allow", status: deny ? 401 : 200, oauthError: deny ? "invalid_token" : null, code: deny ? "expired" : null, checks, exchanged: ex },
    steps: id === "replay" ? [{ label: "First presentation", result: { decision: "allow" } }, { label: "Second presentation of the same token", result: { decision: "deny", code: "replayed" } }] : [{ label: "Exchange", result: { decision: deny ? "deny" : "allow", code: deny ? "expired" : null } }],
    backend: deny ? null : { audience: "https://mcp.example/orders/mcp", exchanged: { accepted: true, why: "issued to this backend" }, original: { accepted: false, why: "the audience is not this backend" }, differs: true, logWithOnBehalfOf: "user=user-1001 actor=orders-agent client=x", logWithSharedServiceAccount: "user=(unknown)" },
    hops: [{ n: 1, label: "Agent calls the gateway", traceparent: `00-${"b".repeat(32)}-${"1".repeat(16)}-01`, request: "POST https://gateway.example/mcp", response: "HTTP/1.1 200 OK" }], traceId: "b".repeat(32) };
};

let calls;
let override = {};
function mockFetch() {
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url, opts });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.startsWith("/api/scenarios")) return override.scenarios ? override.scenarios() : json(STORY);
    if (url === "/api/info") return override.info ? override.info() : json({ source: "mock", realAvailable: false, realReason: "Real mode is not available in this build: it needs a live AgentCore Runtime, a PingOne worker app and a person access token, all owner-configured. This lab ships the Mock engine; the shape it models is what a Real run would follow.", liveRefusal: "Mock only: this app has no Live engine (it refuses APD_MODE=live). Nothing here calls a gateway.", simulated: true });
    if (url === "/api/mode") { const b = JSON.parse(opts.body); if (b.source === "real") return json({ error: "conflict", message: "Real mode is not available in this build: it needs a live AgentCore Runtime, a PingOne worker app and a person access token, all owner-configured. This lab ships the Mock engine; the shape it models is what a Real run would follow." }, 409); return json({ source: b.source, realAvailable: false, realReason: "Real mode is not available in this build: it needs a live AgentCore Runtime, a PingOne worker app and a person access token, all owner-configured. This lab ships the Mock engine; the shape it models is what a Real run would follow.", simulated: true }); }
    if (url.startsWith("/api/three-lo") && !url.endsWith("/evaluate")) return override.lo ? override.lo(url, opts) : json(LO_STORY);
    if (url === "/api/three-lo/evaluate") { if (override.loEval) return override.loEval(url, opts); const b = JSON.parse(opts.body); if (b.scenario === "bad") return json({ error: "unknown_scenario", detail: "no such scenario" }, 400); return json(loRun(b.scenario)); }
    if (url.startsWith("/api/diagram")) return json(DIAGRAM);
    if (url.startsWith("/api/obo")) { if (override.obo) return override.obo(url, opts); return url === "/api/obo/evaluate" ? json(oboRun(JSON.parse(opts.body).scenario, JSON.parse(opts.body))) : json(OBO_STORY); }
    if (url === "/api/reset") return json({ reset: "ok" });
    if (url === "/api/evaluate") {
      const body = JSON.parse(opts.body);
      if (body.scenario) {
        const s = SCEN.find((x) => x.id === body.scenario);
        const trap = s.id === "act-text";
        return json({ decision: s.expected, expected: s.expected, traceId: "a".repeat(32), hops: [hop(1), hop(2), hop(3)],
          checks: [{ path: "client_id", ok: true, reason: "match", detail: "ok" }, { path: "act.sub", ok: !trap, reason: trap ? "parent_not_object" : "match", detail: trap ? "act is the string \"{}\", not an object" : "ok" }],
          flat: trap ? [{ path: "act", value: "{}" }, { path: "client_id", value: "a" }] : [{ path: "act.sub", value: "a" }, { path: "client_id", value: "a" }] });
      }
      return json({ error: "too_deep", detail: "nesting deeper than 6" }, 400);
    }
    return json({}, 404);
  });
}
beforeEach(() => { override = {}; mockFetch(); window.location.hash = ""; });

const ready = async () => { render(<App />); await screen.findByText("Allowed: act.sub matches"); await screen.findByTestId("verdict"); };

describe("shell", () => {
  it("shows the banner, the mode, and sends X-Workspace on API calls", async () => {
    await ready();
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED, MOCK mode/);
    expect(screen.getByTestId("mode")).toHaveTextContent("Mock");
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    const ev = calls.find((c) => c.url === "/api/evaluate");
    expect(ev.opts.headers["x-workspace"]).toMatch(/^[a-z0-9-]{1,40}$/);
  });
  it("Reset calls /api/reset", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/reset" && c.opts.method === "POST")).toBe(true));
  });
});

describe("Mock | Real toggle (every page, rule 19)", () => {
  it("is in the header on every tab; Mock is pressed; Real is disabled with the server's how-to tooltip and the page stays in mock", async () => {
    await ready();
    for (const name of ["M2M gate", "USER_FEDERATION (3LO)", "On-behalf-of", "Diagram", "Talk track"]) {
      await userEvent.click(screen.getByRole("tab", { name }));
      expect(screen.getByRole("group", { name: "Mode" })).toBeVisible();
      expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("mode-real")).toBeDisabled();
    }
    await userEvent.click(screen.getByTestId("mode-real")); // a disabled button does nothing
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("banner")).toHaveAttribute("data-state", "mock");
  });
  it("pressing Mock when already on Mock makes no request", async () => {
    await ready();
    const before = calls.length;
    await userEvent.click(screen.getByTestId("mode-mock"));
    expect(calls.length).toBe(before);
  });
  it("switching to Mock after a Real press POSTs /api/mode with exactly {source} and reloads the data", async () => {
    override.info = async () => ({ ok: true, status: 200, json: async () => ({ source: "real", realAvailable: true, realReason: null, simulated: true }) });
    await ready();
    await userEvent.click(screen.getByTestId("mode-mock"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/mode" && JSON.parse(c.opts.body).source === "mock")).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/evaluate" && c.url === "/api/mode" ? false : c.url === "/api/evaluate" && calls.indexOf(c) > calls.findIndex((x) => x.url === "/api/mode"))).toBe(true));
  });
});

describe("M2M gate tab", () => {
  it("allows the matching scenario and shows token JSON, rule, flattened paths and hops", async () => {
    await ready();
    expect(screen.getByTestId("verdict")).toHaveTextContent("ALLOW");
    expect(screen.getByTestId("token-claims")).toHaveTextContent('"sub": "a"');
    expect(screen.getByTestId("rule-json")).toHaveTextContent("act.sub");
    expect(within(screen.getByTestId("flat-table")).getByText("act.sub")).toBeInTheDocument();
    expect(screen.getByTestId("hops")).toHaveTextContent(/traceparent: 00-a{32}-1{16}-01/);
    expect(screen.getByTestId("facts")).toHaveTextContent("measured");
  });
  it('denies the act="{}" trap with parent_not_object', async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: /text "\{\}"/ }));
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent("DENY"));
    expect(screen.getByTestId("verdict").querySelector('[data-reason="parent_not_object"]')).not.toBeNull();
    expect(screen.getByTestId("lesson")).toHaveTextContent("The trap.");
  });
  it("custom editor: invalid JSON and a server 400 both show inline errors", async () => {
    await ready();
    const box = screen.getByLabelText(/Token claims/);
    await userEvent.clear(box);
    await userEvent.type(box, "not json");
    await userEvent.click(screen.getByRole("button", { name: "Evaluate custom" }));
    expect(await screen.findByTestId("custom-error")).toHaveTextContent("not valid JSON");
    await userEvent.clear(box);
    await userEvent.click(box);
    await userEvent.paste('{"a": 1}');
    await userEvent.click(screen.getByRole("button", { name: "Evaluate custom" }));
    await waitFor(() => expect(screen.getByTestId("custom-error")).toHaveTextContent("too_deep: nesting deeper than 6"));
  });
});

describe("USER_FEDERATION (3LO) tab", () => {
  const openLo = async () => { await ready(); await userEvent.click(screen.getByRole("tab", { name: "USER_FEDERATION (3LO)" })); await screen.findByTestId("three-lo-tab"); };
  it("shows the steps, the two configured shapes and the claim rows, tagged", async () => {
    await openLo();
    expect(screen.getByTestId("tl-steps")).toHaveTextContent("GetResourceOauth2Token");
    expect(screen.getByTestId("tl-app")).toHaveTextContent("POST");
    expect(screen.getByTestId("tl-provider")).toHaveTextContent("USER_FEDERATION");
    expect(screen.getByTestId("tl-provider")).toHaveTextContent("sessionUri");
    const claims = within(screen.getByTestId("tl-claims"));
    expect(claims.getByText("measured (our note)")).toBeInTheDocument();
    expect(claims.getByText("lab-invented")).toBeInTheDocument();
  });
  it("runs the allowed scenario and shows the token with the human's sub", async () => {
    await openLo();
    await waitFor(() => expect(screen.getByTestId("tl-verdict")).toHaveTextContent("ALLOW"));
    expect(screen.getByTestId("tl-token")).toHaveTextContent('"sub": "user-1001"');
    expect(screen.getByTestId("tl-user")).toHaveTextContent("Alex Rivera");
    expect(screen.getByTestId("tl-lesson")).toHaveTextContent("Every step lines up.");
    expect(calls.filter((c) => c.url === "/api/three-lo/evaluate").every((c) => c.opts.headers["x-workspace"])).toBe(true);
  });
  it("a denied scenario names the failing check, the not-reached ones and the code, and mints no token", async () => {
    await openLo();
    await userEvent.click(screen.getByRole("button", { name: /callback URL does not match/ }));
    await waitFor(() => expect(screen.getByTestId("tl-verdict")).toHaveTextContent("DENY"));
    expect(screen.getByTestId("tl-verdict")).toHaveTextContent("redirect_uri_mismatch");
    expect(screen.getByTestId("tl-checks")).toHaveTextContent(/callback-match: failed/);
    expect(screen.getByTestId("tl-checks")).toHaveTextContent(/session-preregistered: not reached/);
    expect(screen.queryByTestId("tl-token")).toBeNull();
    expect(screen.getByTestId("tl-lesson")).toHaveTextContent("They must match exactly.");
  });
  it("the no-user-context scenario shows the deploy-user token that names no human", async () => {
    await openLo();
    await userEvent.click(screen.getByRole("button", { name: /token names no human/ }));
    await waitFor(() => expect(screen.getByTestId("tl-verdict")).toHaveTextContent("DENY"));
    expect(screen.getByTestId("tl-token")).toHaveTextContent("deploy-user");
    expect(screen.queryByTestId("tl-user")).toBeNull();
  });
  it("a server refusal is shown as text, not as markup", async () => {
    override.loEval = async () => ({ ok: false, status: 400, json: async () => ({ error: "unknown_scenario", detail: "no such scenario" }) });
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "USER_FEDERATION (3LO)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("unknown_scenario: no such scenario");
  });
  it("ignores a slow answer that arrives after a newer one (stale-response guard)", async () => {
    let release; const slow = new Promise((r) => { release = r; });
    let n = 0;
    override.loEval = (url, opts) => {
      const b = JSON.parse(opts.body); n += 1;
      // The FIRST (allow) answer is slow; the second click's (deny) answer comes back fast.
      if (n === 1) return slow.then(() => ({ ok: true, status: 200, json: async () => loRun("allowed") }));
      return { ok: true, status: 200, json: async () => loRun(b.scenario) };
    };
    override.lo = () => ({ ok: true, status: 200, json: async () => LO_STORY }); // openLo's own load must not consume a click counter
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "USER_FEDERATION (3LO)" }));
    await screen.findByTestId("three-lo-tab");
    // The first evaluate (the tab's auto-run of "allowed") is the slow one.
    await userEvent.click(screen.getByRole("button", { name: /callback URL does not match/ }));
    await waitFor(() => expect(screen.getByTestId("tl-verdict")).toHaveTextContent("DENY"));
    release(); // the first click's slow answer arrives now
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId("tl-verdict")).toHaveTextContent("DENY"); // the slow (allow) answer did not overwrite it
  });
  it("Reset runs the scenario again from the server", async () => {
    await openLo();
    await userEvent.click(screen.getByRole("button", { name: /callback URL does not match/ }));
    await waitFor(() => expect(screen.getByTestId("tl-verdict")).toHaveTextContent("DENY"));
    const before = calls.filter((c) => c.url === "/api/three-lo/evaluate").length;
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/three-lo/evaluate").length).toBeGreaterThan(before));
    expect(screen.getByTestId("tl-verdict")).toHaveTextContent("DENY"); // the same scenario re-ran
  });
});

describe("diagram tab", () => {
  it("draws the boxes from /api/diagram and Simulate highlights a step; Reset clears it", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Diagram" }));
    expect(await screen.findByText("Agent (AgentCore Runtime)")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/diagram?vertical=retail"))).toBe(true);
    expect(screen.getByTestId("banner")).toBeInTheDocument();
    expect(screen.getByLabelText(/Step time/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /simulate/i }));
    expect(await screen.findByTestId("pattern-now")).toHaveTextContent("Step 1: Bearer token");
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.queryByTestId("pattern-now")).toBeNull());
  });
  it("offers the three diagrams by name", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Diagram" }));
    for (const name of ["USER_FEDERATION (3LO)", "On-behalf-of", "M2M gate"]) {
      await userEvent.click(await screen.findByRole("button", { name }));
      await waitFor(() => expect(calls.some((c) => c.url.startsWith("/api/diagram"))).toBe(true));
    }
    expect(calls.some((c) => /name=three-lo/.test(c.url))).toBe(true);
    expect(calls.some((c) => /name=obo/.test(c.url))).toBe(true);
    expect(calls.some((c) => /name=m2m-gate/.test(c.url))).toBe(true);
  });
});

describe("talk track and presenter mode", () => {
  it("lists the talk track; presenter mode keeps the banner and shows the say-text; Esc leaves", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Talk track" }));
    expect(screen.getByTestId("talk-track")).toHaveTextContent("Everything is simulated.");
    await userEvent.click(screen.getByRole("tab", { name: "M2M gate" }));
    await userEvent.keyboard("p");
    expect(await screen.findByTestId("presenter-say")).toHaveTextContent("Walk the five scenarios.");
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED/);
    expect(document.querySelector(".app--presenter")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".app--presenter")).toBeNull();
  });
  it("P ignores modifier keys (Cmd/Ctrl/Alt+P is the browser's) and keystrokes in a text box; Esc keeps the banner", async () => {
    await ready();
    await userEvent.keyboard("{Control>}p{/Control}{Meta>}p{/Meta}{Alt>}p{/Alt}");
    expect(document.querySelector(".app--presenter")).toBeNull();
    await userEvent.click(screen.getByLabelText(/Token claims/));
    await userEvent.keyboard("p");
    expect(document.querySelector(".app--presenter")).toBeNull();
    await userEvent.click(document.body);
    await userEvent.keyboard("P");
    expect(document.querySelector(".app--presenter")).not.toBeNull();
    expect(screen.getByTestId("banner")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".app--presenter")).toBeNull();
    expect(screen.getByTestId("banner")).toBeVisible();
  });
  it("presenter mode on the 3LO tab shows the 3LO entries", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "USER_FEDERATION (3LO)" }));
    await screen.findByTestId("three-lo-tab");
    await userEvent.keyboard("p");
    expect(await screen.findByTestId("presenter-say")).toHaveTextContent("Four shapes decide it.");
  });
});

describe("diagram edge labels", () => {
  it("nudges the two labels of a back-and-forth pair in opposite directions and leaves the rest alone", () => {
    const steps = [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "a", to: "c" }];
    expect(labelOffsets(steps)).toEqual([-16, 16, 0]);
    expect(labelOffsets([])).toEqual([]);
  });
});

describe("banner visibility on every tab and in presenter mode", () => {
  it("is visible (not hidden, not display:none) on every tab and in presenter mode", async () => {
    await ready();
    for (const name of ["M2M gate", "USER_FEDERATION (3LO)", "On-behalf-of", "Diagram", "Talk track"]) {
      await userEvent.click(screen.getByRole("tab", { name }));
      expect(screen.getByTestId("banner")).toBeVisible();
      expect(screen.getByTestId("banner")).not.toHaveAttribute("hidden");
    }
    await userEvent.click(screen.getByRole("tab", { name: "M2M gate" }));
    await userEvent.keyboard("p");
    await screen.findByTestId("presenter-say");
    expect(screen.getByTestId("banner")).toBeVisible();
  });
  it("until /api/scenarios answers the banner is the fixed MOCK text, never blank and never claiming anything else", async () => {
    override.scenarios = () => new Promise(() => {});
    render(<App />);
    expect(screen.getByTestId("banner")).toHaveTextContent(BANNER_UNKNOWN);
    expect(screen.getByTestId("banner")).toBeVisible();
    expect(BANNER_UNKNOWN).toMatch(/^SIMULATED, MOCK mode/);
  });
  it("while nothing has answered, and when both calls fail, the fixed banner stays visible", async () => {
    override.info = () => new Promise(() => {});
    override.scenarios = () => new Promise(() => {});
    const { unmount } = render(<App />);
    expect(screen.getByTestId("banner")).toHaveTextContent(BANNER_UNKNOWN);
    unmount();
    override.info = async () => ({ ok: false, status: 500, json: async () => ({}) });
    override.scenarios = async () => ({ ok: false, status: 500, json: async () => ({}) });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the lab");
    expect(screen.getByTestId("banner")).toHaveTextContent(BANNER_UNKNOWN);
    expect(screen.getByTestId("banner")).toBeVisible();
  });
});

describe("links from the content pack: /#scenario-<id>", () => {
  it("opens the gate tab on that scenario and runs it", async () => {
    window.location.hash = "#scenario-act-text";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent("DENY"));
    expect(screen.getByRole("tab", { name: "M2M gate" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /text "\{\}"/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("verdict").querySelector('[data-reason="parent_not_object"]')).not.toBeNull();
  });
  it("an unknown or hostile id falls back to the first scenario", async () => {
    for (const h of ["#scenario-nope", "#scenario-__proto__", "#scenario-" + "a".repeat(80)]) {
      window.location.hash = h;
      const { unmount } = render(<App />);
      await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent("ALLOW"));
      expect(screen.getByRole("button", { name: /Allowed/ })).toHaveAttribute("aria-pressed", "true");
      unmount();
    }
  });
  it("a hash change while open switches the scenario", async () => {
    await ready();
    window.location.hash = "#scenario-act-text";
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent("DENY"));
  });
});

describe("accessibility structure and display safety", () => {
  it("has one main landmark, one banner status inside the header, and a tabpanel that is not the main", async () => {
    await ready();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("banner")).toContainElement(screen.getByTestId("banner"));
    expect(screen.getByRole("tabpanel")).not.toBe(screen.getByRole("main"));
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("tabpanel"));
  });
  it("control and bidi characters are shown as visible escapes", () => {
    expect(visible("a" + String.fromCharCode(0x202e) + "b" + String.fromCharCode(7) + "c" + String.fromCharCode(0x200b) + "d" + String.fromCharCode(0x85) + "e")).toBe("a" + String.fromCharCode(92) + "u202eb" + String.fromCharCode(92) + "u0007c" + String.fromCharCode(92) + "u200bd" + String.fromCharCode(92) + "u0085e");
    expect(visible("line" + String.fromCharCode(10) + "Tab" + String.fromCharCode(9))).toBe("line\nTab\t");
  });
});

const RELEASE_WORDS = /^Ping release claim, UNVERIFIED on our tenant/;
const openTab = async (name) => { await userEvent.click(screen.getByRole("tab", { name })); };
const pickVertical = async (v) => { await userEvent.selectOptions(screen.getByLabelText(/Vertical/), v); };
const ALL_TABS = ["M2M gate", "USER_FEDERATION (3LO)", "On-behalf-of", "Diagram", "Talk track"];

describe("release tabs: banner, mode and presenter", () => {
  it("the on-behalf-of tab shows the release banner (and the mock-only line) on top of the simulation banner", async () => {
    await ready();
    expect(screen.queryByTestId("release-banner")).toBeNull(); // the other tabs are unchanged
    await openTab("On-behalf-of");
    expect(screen.getByTestId("release-banner")).toHaveTextContent(RELEASE_WORDS);
    expect(screen.getByTestId("release-banner")).toBeVisible();
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED, MOCK mode/);
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByTestId("obo-no-live")).toHaveTextContent("no Live engine");
  });
  it("the release banner stays in presenter mode, with the matching talk track and the why-it-matters line", async () => {
    await ready();
    await openTab("On-behalf-of"); await screen.findByTestId("obo-tab");
    await userEvent.keyboard("p");
    expect(await screen.findByTestId("presenter-say")).toHaveTextContent("Swap the token.");
    expect(screen.getByTestId("presenter-say")).toHaveTextContent("slide 48");
    expect(screen.getByTestId("release-banner")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".app--presenter")).toBeNull();
  });
  it("the banner is there even while the tab is still loading or its server call failed", async () => {
    override.obo = () => new Promise(() => {});
    await ready(); await openTab("On-behalf-of");
    expect(screen.getByTestId("release-banner")).toBeVisible();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    override.obo = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await userEvent.click(screen.getByTestId("reset")); await pickVertical("health");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the on-behalf-of tab");
    expect(screen.getByTestId("release-banner")).toBeVisible();
  });
  it("opens from the content-pack link /#obo", async () => {
    window.location.hash = "#obo";
    render(<App />);
    expect(await screen.findByTestId("obo-tab")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "On-behalf-of" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("render guard: changing the vertical on EVERY tab never blanks the page", () => {
  it("every tab keeps the header, banner, tab strip and a non-empty panel across vertical changes", async () => {
    await ready();
    for (const name of ALL_TABS) {
      await openTab(name);
      for (const v of ["health", "retail"]) {
        await pickVertical(v);
        expect(screen.getByTestId("banner")).toBeVisible();
        expect(screen.getByRole("tablist")).toBeInTheDocument();
        expect(screen.queryByTestId("tab-crash")).toBeNull();
        await waitFor(() => expect(screen.getByRole("tabpanel").textContent.length).toBeGreaterThan(20));
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AgentCore PingOne LAB");
      }
    }
  });
  it("a tab that cannot be drawn shows a notice, keeps the banner and the tabs, and clears on another tab or another vertical", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      override.obo = async (url) => (url === "/api/obo/evaluate" ? { ok: true, status: 200, json: async () => ({}) } : { ok: true, status: 200, json: async () => OBO_STORY }); // an answer with no result
      await ready(); await openTab("On-behalf-of");
      expect(await screen.findByTestId("tab-crash")).toHaveTextContent("could not be drawn");
      expect(screen.getByTestId("banner")).toBeVisible(); expect(screen.getByTestId("release-banner")).toBeVisible(); expect(screen.getByRole("tablist")).toBeInTheDocument();
      await openTab("M2M gate");
      expect(screen.queryByTestId("tab-crash")).toBeNull(); expect(await screen.findByTestId("verdict")).toBeInTheDocument();
      override.obo = undefined; await openTab("On-behalf-of");
      expect(await screen.findByTestId("obo-verdict")).toBeInTheDocument();
    } finally { spy.mockRestore(); }
  });
});

describe("on-behalf-of tab", () => {
  const openObo = async () => { await ready(); await openTab("On-behalf-of"); await screen.findByTestId("obo-verdict"); };
  it("runs the first scenario, shows the checks, the two tokens, the backend view and the mock hops with a traceparent", async () => {
    await openObo();
    await waitFor(() => expect(screen.getByTestId("obo-verdict")).toHaveTextContent("ALLOW"));
    expect(screen.getByTestId("obo-checks")).toHaveTextContent("passed");
    expect(screen.getByTestId("obo-exchanged")).toHaveTextContent("MOCK-HS256");
    expect(screen.getByTestId("obo-inbound")).toHaveTextContent("user-1001");
    expect(screen.getByTestId("obo-backend")).toHaveTextContent(/Exchanged token\s*accepted/);
    expect(screen.getByTestId("obo-backend")).toHaveTextContent(/Caller's own token\s*refused/);
    expect(screen.getByTestId("obo-hops")).toHaveTextContent(/POST https:\/\/gateway\.example\/mcp/);
    expect(calls.filter((c) => c.url === "/api/obo/evaluate").every((c) => c.opts.headers["x-workspace"] && JSON.parse(c.opts.body).vertical === "retail")).toBe(true);
  });
  it("a refused scenario says which check refused and which were not reached, and no token is minted", async () => {
    await openObo();
    await userEvent.click(screen.getByRole("button", { name: /caller token has expired/ }));
    await waitFor(() => expect(screen.getByTestId("obo-verdict")).toHaveTextContent("DENY"));
    expect(screen.getByTestId("obo-checks")).toHaveTextContent(/inbound_expiry: refused/);
    expect(screen.getByTestId("obo-checks")).toHaveTextContent(/resource: not reached/);
    expect(screen.getByTestId("obo-exchanged")).toHaveTextContent("None");
    expect(screen.getByTestId("obo-backend")).toHaveTextContent("nothing reached the backend");
    expect(screen.getByTestId("obo-lesson")).toHaveTextContent("Expired is not exchanged.");
  });
  it("the replay scenario lists both presentations", async () => {
    await openObo();
    await userEvent.click(screen.getByRole("button", { name: /replayed/ }));
    await waitFor(() => expect(screen.getByTestId("obo-verdict")).toHaveTextContent("Second presentation of the same token: refused (replayed)"));
    expect(screen.getByTestId("obo-verdict")).toHaveTextContent("First presentation: allowed");
  });
  it("changing the backend and the requested scope each send that field to the server, then show the new verdict", async () => {
    await openObo();
    await userEvent.selectOptions(screen.getByLabelText("Backend (Resource)"), "reports");
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/obo/evaluate").some((c) => JSON.parse(c.opts.body).resource === "reports")).toBe(true));
    await waitFor(() => expect(screen.getByTestId("obo-verdict")).toHaveTextContent("DENY"));
    const box = screen.getByLabelText(/Requested scope/);
    await userEvent.clear(box); await userEvent.type(box, "orders:read orders:write");
    await userEvent.click(screen.getByRole("button", { name: "Evaluate this request" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/obo/evaluate" && JSON.parse(c.opts.body).scope === "orders:read orders:write")).toBe(true));
  });
  it("a server refusal is shown as text, not as markup", async () => {
    override.obo = async (url) => (url === "/api/obo/evaluate" ? { ok: false, status: 400, json: async () => ({ error: "bad_scope", detail: "a scope name has a character the lab does not take" }) } : { ok: true, status: 200, json: async () => OBO_STORY });
    await ready(); await openTab("On-behalf-of");
    expect(await screen.findByTestId("obo-fail")).toHaveTextContent("bad_scope: a scope name has a character the lab does not take");
  });
  it("ignores a slow answer that arrives after a newer one (stale-response guard)", async () => {
    let release; const slow = new Promise((r) => { release = r; });
    let n = 0;
    override.obo = (url, opts) => {
      if (url !== "/api/obo/evaluate") return { ok: true, status: 200, json: async () => OBO_STORY };
      const b = JSON.parse(opts.body); n += 1;
      if (n === 1) return slow.then(() => ({ ok: true, status: 200, json: async () => oboRun("allowed", b) }));
      return { ok: true, status: 200, json: async () => oboRun(b.scenario, b) };
    };
    await ready(); await openTab("On-behalf-of"); await screen.findByTestId("obo-tab");
    await userEvent.click(screen.getByRole("button", { name: /caller token has expired/ }));
    await waitFor(() => expect(screen.getByTestId("obo-verdict")).toHaveTextContent("DENY"));
    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId("obo-verdict")).toHaveTextContent("DENY"); // the first (allow) answer did not overwrite it
  });
  it("tags every row: deck, reading and invented are all shown, and the write-only fields are named but never given a value", async () => {
    await openObo();
    const claimRows = within(screen.getByTestId("obo-claim-rows"));
    expect(claimRows.getByText("deck claim")).toBeInTheDocument(); expect(claimRows.getByText("lab reading")).toBeInTheDocument();
    const cfg = within(screen.getByTestId("obo-config-rows"));
    expect(cfg.getAllByText("console swagger name (schema only)").length).toBe(3);
    expect(screen.getByTestId("obo-config-rows")).toHaveTextContent("write-only here");
    expect(screen.getByTestId("obo-facts")).toHaveTextContent("lab-invented");
    expect(screen.getByTestId("why-matters")).toHaveTextContent("Per Ping's deck, slide 48");
    expect(screen.getByTestId("why-matters")).toHaveTextContent("Business value");
  });
  it("Reset runs the scenario again from its own defaults", async () => {
    await openObo();
    await userEvent.selectOptions(screen.getByLabelText("Backend (Resource)"), "reports");
    await waitFor(() => expect(screen.getByTestId("obo-verdict")).toHaveTextContent("DENY"));
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("obo-verdict")).toHaveTextContent("ALLOW"));
    expect(screen.getByLabelText("Backend (Resource)")).toHaveValue("orders");
  });
});
