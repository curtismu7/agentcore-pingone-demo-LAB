import { useCallback, useEffect, useRef, useState } from "react";
import Json from "./Json";
import { evaluate } from "../api";
import { visible } from "../safeText";

const STATUS_CLASS = { measured: "tag tag--ok", inferred: "tag", UNVERIFIED: "tag tag--warn" };

export function Verdict({ result }) {
  if (!result) return <p className="muted" data-testid="verdict-empty">Pick a scenario to run it.</p>;
  const allow = result.decision === "allow";
  return (
    <div className={`verdict verdict--${allow ? "allow" : "deny"}`} data-testid="verdict" role="status">
      <strong className="verdict__word">{allow ? "ALLOW" : "DENY"}</strong>
      {result.expected && <span> (expected {result.expected.toUpperCase()})</span>}
      <ul className="verdict__reasons">
        {result.checks.map((c) => <li key={c.path}><code>{visible(c.path)}</code>: <span className="reason" data-reason={c.reason}>{c.reason}</span> - {visible(c.detail)}</li>)}
      </ul>
    </div>
  );
}

export function FlatTable({ flat }) {
  return (
    <table className="tbl" data-testid="flat-table">
      <caption>Flattened claims (dotted paths)</caption>
      <thead><tr><th scope="col">Path</th><th scope="col">Value</th></tr></thead>
      <tbody>{flat.map((f) => <tr key={f.path}><td><code>{visible(f.path)}</code></td><td><code>{visible(JSON.stringify(f.value))}</code></td></tr>)}</tbody>
    </table>
  );
}

export function Hops({ hops, traceId }) {
  return (
    <section aria-label="Mock hops with traceparent" data-testid="hops">
      <h3>Hops (W3C traceparent) <span className="muted">trace {traceId}</span></h3>
      {hops.map((h) => (
        <details key={h.n} open={h.n === 1}>
          <summary>{h.n}. {h.label}</summary>
          <p className="muted">Request</p><Json value={h.request} label={`Request of hop ${h.n}`} />
          <p className="muted">Response</p><Json value={h.response} label={`Response of hop ${h.n}`} />
        </details>
      ))}
    </section>
  );
}

function CustomEditor({ scenario, rule, onResult, resetSignal }) {
  const initialToken = JSON.stringify(scenario.token.claims, null, 2);
  const initialRule = JSON.stringify({ requiredClaims: rule.requiredClaims }, null, 2);
  const [tokenText, setTokenText] = useState(initialToken);
  const [ruleText, setRuleText] = useState(initialRule);
  const [error, setError] = useState(null);
  useEffect(() => { setTokenText(initialToken); setRuleText(initialRule); setError(null); }, [initialToken, initialRule, resetSignal]);
  const seq = useRef(0);
  const run = async () => {
    setError(null);
    let token; let r;
    try { token = JSON.parse(tokenText); } catch { return setError("Token claims are not valid JSON."); }
    try { r = JSON.parse(ruleText); } catch { return setError("Rule is not valid JSON."); }
    const mine = ++seq.current;
    const res = await evaluate({ token, rule: r });
    if (mine !== seq.current) return; // a newer request is in flight: this answer is stale
    if (!res.ok) return setError(`${res.body.error || `HTTP ${res.status}`}${res.body.detail ? `: ${res.body.detail}` : ""}`);
    onResult(res.body);
  };
  return (
    <section className="panel" aria-labelledby="custom-h">
      <h3 id="custom-h">Custom token and rule</h3>
      <p className="muted">Edit the claims or the rule and evaluate. Input is bounded: 8 KB, depth 6, 200 claims.</p>
      <label htmlFor="custom-token">Token claims (JSON)</label>
      <textarea id="custom-token" rows={10} value={tokenText} onChange={(e) => setTokenText(e.target.value)} spellCheck={false} />
      <label htmlFor="custom-rule">Rule (JSON, requiredClaims: path + equals)</label>
      <textarea id="custom-rule" rows={7} value={ruleText} onChange={(e) => setRuleText(e.target.value)} spellCheck={false} />
      <button type="button" onClick={run}>Evaluate custom</button>
      {error && <p className="field-error" role="alert" data-testid="custom-error">{error}</p>}
    </section>
  );
}

export default function ClaimGate({ story, resetSignal, requestedId, onSelect }) {
  const known = (v) => story.scenarios.some((s) => s.id === v);
  const [id, setId] = useState(known(requestedId) ? requestedId : story.scenarios[0].id);
  // A link such as /#scenario-act-text selects that scenario; an unknown id keeps the current one.
  useEffect(() => { if (known(requestedId)) setId(requestedId); }, [requestedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [result, setResult] = useState(null);
  const scenario = story.scenarios.find((s) => s.id === id) || story.scenarios[0];
  const [fail, setFail] = useState(null);
  const seq = useRef(0);
  const run = useCallback(async (sid) => {
    const mine = ++seq.current;
    setFail(null);
    const res = await evaluate({ scenario: sid }).catch(() => ({ ok: false, status: 0, body: {} }));
    if (mine !== seq.current) return; // a newer request is in flight: this answer is stale
    if (res.ok) setResult(res.body); else { setResult(null); setFail(`Could not evaluate (${res.body.error || res.status}).`); }
  }, []);
  useEffect(() => { setResult(null); }, [resetSignal]);
  useEffect(() => { run(id); }, [id, story.cast.castAgentId, run, resetSignal]);
  return (
    <div className="gate">
      <section className="panel" aria-labelledby="sc-h">
        <h2 id="sc-h">Scenarios</h2>
        <div className="seg" role="group" aria-label="Scenario">
          {story.scenarios.map((s) => <button key={s.id} type="button" aria-pressed={s.id === id} onClick={() => { setId(s.id); if (onSelect) onSelect(s.id); }}>{visible(s.title)}</button>)}
        </div>
        <p className="lesson" data-testid="lesson">{visible(scenario.lesson)}</p>
      </section>
      <section className="panel" aria-labelledby="res-h">
        <h2 id="res-h">Result</h2>
        {fail && <p className="field-error" role="alert">{fail}</p>}
        <Verdict result={result} />
        {result && <FlatTable flat={result.flat} />}
        {result && <Hops hops={result.hops} traceId={result.traceId} />}
      </section>
      <section className="panel" aria-labelledby="tok-h">
        <h2 id="tok-h">Token (decoded)</h2>
        <p className="tag tag--warn">{story.tokenLabel}</p>
        <h3>Header</h3><Json value={scenario.token.header} label="Token header" />
        <h3>Payload (claims)</h3><Json value={scenario.token.claims} label="Token payload" testId="token-claims" />
        <h3>Signature</h3><Json value={scenario.token.signature} label="Token signature" />
      </section>
      <section className="panel" aria-labelledby="rule-h">
        <h2 id="rule-h">Rule: {story.rule.name}</h2>
        <p className="muted">{story.rule.appliesTo}</p>
        <Json value={{ requiredClaims: story.rule.requiredClaims }} label="Rule" testId="rule-json" />
        <p className="muted">{story.rule.note}</p>
        <h3>What we know, and how well</h3>
        <ul className="facts" data-testid="facts">
          {story.facts.map((f) => <li key={f.id}><span className={STATUS_CLASS[f.status] || "tag"}>{f.status}</span> {visible(f.text)} <span className="muted">Source: {visible(f.source)}.</span></li>)}
        </ul>
      </section>
      <CustomEditor scenario={scenario} rule={story.rule} onResult={setResult} resetSignal={resetSignal} />
    </div>
  );
}
