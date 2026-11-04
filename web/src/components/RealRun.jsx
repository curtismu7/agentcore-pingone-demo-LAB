import React, { useCallback, useEffect, useState } from "react";
import { getJson } from "../api";

// The Real tab: one live M2M run through AWS AgentCore Identity -> PingOne, shown the same way the Mock
// gate shows tokens: raw values, decoded claims, every check visible. The button 409s with the owner
// how-to when Real is not configured - that refusal is data, and this tab shows it as such.
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
              <h3>Raw token</h3>
              <pre className="token-box" data-testid="real-token">{run.rawToken}</pre>
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
