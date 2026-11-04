import { workspaceFetch } from "./workspace";

export async function getJson(url) {
  const r = await workspaceFetch(url, { method: "GET" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// POST /api/evaluate. Returns { ok, body }: a 400 is data (a code and a detail), not an exception.
export async function evaluate(payload) {
  const r = await workspaceFetch("/api/evaluate", { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

export const resetWorkspace = () => workspaceFetch("/api/reset", { method: "POST", body: "{}" }).then((r) => r.ok);

// POST /api/mode: the rule-19 Mock/Real switch. A 409 (Real unconfigured) is data, not an exception.
export async function requestModeSwitch(source) {
  const r = await workspaceFetch("/api/mode", { method: "POST", body: JSON.stringify({ source }) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(body.message || body.detail || `HTTP ${r.status}`);
  return body;
}

// POST /api/three-lo/evaluate: a USER_FEDERATION (3LO) scenario id.
export const evaluateThreeLo = (payload) => post("/api/three-lo/evaluate", payload);

const post = async (url, payload) => {
  const r = await workspaceFetch(url, { method: "POST", body: JSON.stringify(payload) });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
};
// POST /api/obo/evaluate: a scenario id, optionally the backend choice and the scope text (the release tab, on-behalf-of).
export const evaluateObo = (payload) => post("/api/obo/evaluate", payload);
