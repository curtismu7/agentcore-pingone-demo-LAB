import React, { useCallback, useEffect, useRef, useState } from "react";
import { getJson } from "../api";

// The Real tab: one live M2M run through AWS AgentCore Identity -> PingOne, shown the same way the Mock
// gate shows tokens: raw values, decoded claims, every check visible. The button 409s with the owner
// how-to when Real is not configured - that refusal is data, and this tab shows it as such.

function ThreeLoPanel({ realOn }) {
  const [state, setState] = useState("idle"); // idle | waiting | done | error
  const [detail, setDetail] = useState(null);
  const [userId, setUserId] = useState("demoUser");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const start = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/real/3lo/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "orders:read", userId }),
      });
      const j = await r.json();
      if (j.ok && j.authorizationUrl) {
        setState("waiting");
        window.open(j.authorizationUrl, "_blank", "noopener");
        pollRef.current = setInterval(async () => {
          const pr = await fetch("/api/real/3lo/result");
          const pj = await pr.json();
          if (pj.pending) return;
          clearInterval(pollRef.current); pollRef.current = null;
          if (pj.ok) { setDetail(pj); setState("done"); } else { setDetail(pj); setState("error"); }
        }, 2000);
      } else {
        setDetail(j); setState("error");
      }
    } catch (e) { setDetail({ error: String(e) }); setState("error"); }
    finally { setBusy(false); }
  };

  return (
    <section aria-label="Real 3LO: a real human login">
      <h3>Real 3LO: a real human signs in</h3>
      <p>
        This is the USER_FEDERATION flow: the server mints a user-bound workload token, AgentCore Identity
        returns a real PingOne authorization URL, <strong>you</strong> sign in as a real PingOne user, and the
        token that comes back carries <code>sub</code> = the human - not the agent&apos;s client_id. That
        difference is the whole lesson.
      </p>
      {!realOn && <p className="banner" data-testid="real3lo-off">Real is not configured - see the Mode switch tooltip.</p>}
      <div className="actions">
        <label htmlFor="apd-3lo-user" className="muted">PingOne user id: </label>
        <input id="apd-3lo-user" value={userId} onChange={(e) => setUserId(e.target.value)} size={18} data-testid="real3lo-user" />
        <button type="button" className="btn" disabled={busy || !realOn || state === "waiting"} onClick={start} data-testid="real3lo-start">
          {state === "waiting" ? "Waiting for sign-in..." : busy ? "Starting..." : "Start real sign-in"}
        </button>
      </div>
      {state === "waiting" && <p className="banner" data-testid="real3lo-waiting">Complete the PingOne sign-in in the tab that just opened (the link is single-use; press Start again for a fresh one). This page polls until the callback lands.</p>}
      {state === "done" && detail && (
        <div data-testid="real3lo-result">
          <h4>Decoded claims (the real user token)</h4>
          <ul>
            {Object.entries(detail.claims || {}).map(([k, v]) => (
              <li key={k}><code>{k}</code>: <code>{typeof v === "string" ? v : JSON.stringify(v)}</code></li>
            ))}
          </ul>
          <p className="muted">scope <code>{detail.scope}</code> - user <code>{detail.userId}</code>{detail.expiresIn ? <> - expires in {detail.expiresIn}s</> : null}</p>
        </div>
      )}
      {state === "error" && <p className="banner" data-testid="real3lo-error">3LO failed: {detail?.error || "unknown"}</p>}
    </section>
  );
}

export default function RealRun({ info }) {
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);

  const runM2m = useCallback(async (scope) => {
    setBusy(true);
    try {
      const r = await fetch("/api/real/m2m", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const j = await r.json();
      setRun({ status: r.status, ...j });
    } catch (e) {
      setRun({ ok: false, error: String(e) });
    } finally {
      setBusy(false);
    }
  }, []);

  const realOn = info?.realAvailable === true && info?.source === "real";
  return (
    <section aria-label="Real mode: live M2M through AgentCore Identity">
      <h2>Real mode: one live M2M run</h2>
      <p>
        The mock gate showed what <em>should</em> happen. This button does it: the server asks AWS AgentCore
        Identity for a Workload Access Token, exchanges it at the token vault against the PingOne credential
        provider, and returns a <strong>real PingOne access token</strong> - decoded below, raw values, nothing
        invented. The token is short-lived and minted fresh on every press.
      </p>
      {!realOn && (
        <p className="banner" data-testid="real-off">
          {info?.realAvailable !== true
            ? "Real is not configured on this deployment (see the Mode switch tooltip for the exact settings the owner must set). The mock gate above is the full model."
            : "Real mode is configured - switch the Mode toggle to Real, then run."}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn" disabled={busy || !realOn} onClick={() => runM2m("orders:read")} data-testid="real-run-read">
          {busy ? "Exchanging..." : "Run live M2M (orders:read)"}
        </button>
        <button type="button" className="btn" disabled={busy || !realOn} onClick={() => runM2m("orders:write")} data-testid="real-run-write">
          Run live M2M (orders:write)
        </button>
      </div>
      <ThreeLoPanel realOn={realOn} />
      {run && (
        <div data-testid="real-result">
          {run.status === 409 ? (
            <p className="banner">Real refused: {run.message || run.error}</p>
          ) : run.ok ? (
            <>
              <h3>Decoded claims (the real token)</h3>
              <ul>
                {Object.entries(run.claims || {}).map(([k, v]) => (
                  <li key={k}><code>{k}</code>: <code>{typeof v === "string" ? v : JSON.stringify(v)}</code></li>
                ))}
              </ul>
              <h3>Token head</h3>
              <pre className="token-box" data-testid="real-token">{run.tokenHead}</pre>
              <p className="muted">
                The full token string is masked in transit by the same guard that protects every response in this
                lab (a JWT never leaves the server unmasked). The decoded claims above are its complete payload,
                so nothing about the token is hidden - only the redundant encoding.
              </p>
              <p className="muted">
                provider <code>{run.provider}</code> - scope <code>{run.scope}</code>
                {run.expiresIn ? <> - expires in {run.expiresIn}s</> : null}
              </p>
            </>
          ) : (
            <p className="banner">The real engine failed: {run.error}</p>
          )}
        </div>
      )}
    </section>
  );
}
