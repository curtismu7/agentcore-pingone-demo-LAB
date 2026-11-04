import { useCallback, useEffect, useRef, useState } from "react";
import Json from "./Json";
import ActionButton from "./ActionButton";
import ClaimTag, { TagLegend, WhyItMatters } from "./ClaimTag";
import { evaluateObo, getJson } from "../api";
import { NO_LIVE } from "../releaseText";
import { visible } from "../safeText";

const CHOICE_LABEL = { orders: "orders backend", reports: "reports backend", unlisted: "a backend the gateway does not know", none: "(blank)" };
const CHECK_WORD = { true: "passed", false: "refused", null: "not reached" };

function Verdict({ run }) {
  if (!run) return null;
  const r = run.result; const allow = r.decision === "allow";
  return (
    <div className={`verdict verdict--${allow ? "allow" : "deny"}`} data-testid="obo-verdict" role="status">
      <strong className="verdict__word">{allow ? "ALLOW" : "DENY"}</strong> <span>lab status {r.status}{r.oauthError ? `, ${visible(r.oauthError)}` : ""}{r.code ? `, ${visible(r.code)}` : ""}</span>
      {run.steps.length > 1 && <ol className="verdict__reasons">{run.steps.map((s) => <li key={s.label}>{s.label}: {s.result.decision === "allow" ? "allowed" : `refused (${visible(s.result.code)})`}</li>)}</ol>}
      <ul className="verdict__reasons" data-testid="obo-checks">
        {r.checks.map((c) => <li key={c.id} data-state={String(c.ok)}><code>{c.id}</code>: {CHECK_WORD[String(c.ok)]}. {visible(c.detail)}</li>)}
      </ul>
    </div>
  );
}

function Backend({ run, tags }) {
  const b = run.backend;
  if (!b) return <p className="muted" data-testid="obo-backend">No token was minted, so nothing reached the backend.</p>;
  const yes = (a) => (a.accepted ? "accepted" : "refused");
  return (
    <dl className="kv" data-testid="obo-backend">
      <dt>Backend audience</dt><dd><code>{visible(b.audience)}</code></dd>
      <dt>Exchanged token</dt><dd>{yes(b.exchanged)}: {visible(b.exchanged.why)}</dd>
      <dt>Caller&apos;s own token</dt><dd>{yes(b.original)}: {visible(b.original.why)}</dd>
      <dt>Differs from the caller token</dt><dd>{b.differs ? "yes" : "no"}</dd>
      <dt>Backend log with on-behalf-of</dt><dd><code>{visible(b.logWithOnBehalfOf)}</code> <ClaimTag tag="reading" tags={tags} /></dd>
      <dt>Backend log with a shared service account</dt><dd><code>{visible(b.logWithSharedServiceAccount)}</code> <ClaimTag tag="invented" tags={tags} /></dd>
    </dl>
  );
}

export default function OnBehalfOf({ vertical, resetSignal }) {
  const [story, setStory] = useState(null);
  const [error, setError] = useState(null);
  const [id, setId] = useState(null);
  const [resource, setResource] = useState(""); // "" = the scenario's own
  const [scope, setScope] = useState(null); // null = the scenario's own
  const [typed, setTyped] = useState("");
  const [run, setRun] = useState(null);
  const [fail, setFail] = useState(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    let live = true;
    getJson(`/api/obo?vertical=${encodeURIComponent(vertical)}`).then((j) => { if (live) { setStory(j); setId(j.scenarios[0].id); setError(null); } }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [vertical]);

  const exec = useCallback(async (sid, res, text) => {
    const mine = ++seq.current; setBusy(true); setFail(null);
    const out = await evaluateObo({ scenario: sid, vertical, ...(res ? { resource: res } : {}), ...(text !== null ? { scope: text } : {}) }).catch(() => ({ ok: false, status: 0, body: {} }));
    if (mine !== seq.current) return; // a newer request is in flight: this answer is stale
    setBusy(false);
    if (out.ok) setRun(out.body); else { setRun(null); setFail(`Could not evaluate (${out.body.error || out.status}${out.body.detail ? `: ${out.body.detail}` : ""}).`); }
  }, [vertical]);

  useEffect(() => { if (id) { setResource(""); setScope(null); setTyped(""); exec(id, "", null); } }, [id, resetSignal, exec]);

  if (error) return <p className="field-error" role="alert">Could not load the on-behalf-of tab ({error}).</p>;
  if (!story || !id) return <p className="muted">Loading...</p>;
  const sc = story.scenarios.find((s) => s.id === id) || story.scenarios[0];
  const shownScope = scope === null ? (run ? run.request.scope : "") : scope;
  const shownChoice = resource || (run ? run.request.resourceChoice : "");
  return (
    <div className="gate release-tab" data-testid="obo-tab">
      <section className="panel">
        <h2>{story.title}</h2>
        <p>{story.intro}</p>
        <p className="muted" data-testid="obo-no-live">{story.noLive || NO_LIVE}</p>
        <TagLegend tags={story.tags} />
      </section>
      <section className="panel" aria-labelledby="obo-run-h">
        <h2 id="obo-run-h">Run an exchange</h2>
        <div className="seg" role="group" aria-label="Scenario">
          {story.scenarios.map((s) => <button key={s.id} type="button" aria-pressed={s.id === id} onClick={() => setId(s.id)}>{s.title}</button>)}
        </div>
        <p><ClaimTag tag={sc.evidence} tags={story.tags} /> <span className="lesson" data-testid="obo-lesson">{sc.lesson}</span></p>
        <label htmlFor="obo-resource">Backend (Resource)</label>
        <select id="obo-resource" value={shownChoice} onChange={(e) => { setResource(e.target.value); exec(id, e.target.value, scope); }}>
          {story.resourceChoices.map((c) => <option key={c} value={c}>{CHOICE_LABEL[c] || c}</option>)}
        </select>
        <label htmlFor="obo-scope">Requested scope (space separated)</label>
        <input id="obo-scope" type="text" value={shownScope} maxLength={200} spellCheck={false} autoComplete="off" onChange={(e) => setScope(e.target.value)} />
        <ActionButton off={busy} onClick={() => exec(id, resource, scope === null ? shownScope : scope)}>Evaluate this request</ActionButton>
        {fail && <p className="field-error" role="alert" data-testid="obo-fail">{fail}</p>}
        <Verdict run={run} />
      </section>
      {run && (
        <>
          <section className="panel" aria-labelledby="obo-tok-h">
            <h2 id="obo-tok-h">The tokens (MOCK-ISSUED)</h2>
            <p className="muted">Signed with a keyed hash the lab computes and recomputes, a stand-in for a real signature. Never a real credential.</p>
            <h3>Caller token (what the agent presented)</h3>
            <Json value={run.inbound} label="Caller token" testId="obo-inbound" />
            <h3>Exchanged token (what the backend receives)</h3>
            {run.result.exchanged ? <Json value={run.result.exchanged} label="Exchanged token" testId="obo-exchanged" /> : <p className="muted" data-testid="obo-exchanged">None: the exchange was refused.</p>}
          </section>
          <section className="panel" aria-labelledby="obo-be-h">
            <h2 id="obo-be-h">What the backend does with it</h2>
            <Backend run={run} tags={story.tags} />
          </section>
          <section className="panel" aria-labelledby="obo-hops-h">
            <h2 id="obo-hops-h">Mock hops (W3C traceparent on each)</h2>
            <div data-testid="obo-hops">
              {run.hops.map((h) => <details key={h.n} open><summary>{h.n}. {h.label}</summary><Json value={`${h.request}\n\n--> ${h.response}`} label={`Hop ${h.n}`} /></details>)}
            </div>
          </section>
        </>
      )}
      <section className="panel" aria-labelledby="obo-claims-h">
        <h2 id="obo-claims-h">Where each exchanged claim comes from</h2>
        <div className="scroll"><table className="tbl" data-testid="obo-claim-rows">
          <thead><tr><th scope="col">Claim</th><th scope="col">How well we know it</th><th scope="col">Note</th></tr></thead>
          <tbody>{story.claimRows.map((r) => <tr key={r.claim}><th scope="row"><code>{r.claim}</code></th><td><ClaimTag tag={r.tag} tags={story.tags} /></td><td>{r.note}</td></tr>)}</tbody>
        </table></div>
        <h3>The exchange config (console swagger field names)</h3>
        <div className="scroll"><table className="tbl" data-testid="obo-config-rows">
          <thead><tr><th scope="col">Field</th><th scope="col">Mock value</th><th scope="col">How well we know it</th></tr></thead>
          <tbody>{story.configRows.map((r) => <tr key={r.field}><th scope="row"><code>{r.field}</code></th><td>{Object.hasOwn(story.config, r.field) ? (story.config[r.field] === "" ? "(blank)" : <code>{story.config[r.field]}</code>) : <span className="muted">{r.note || "not modelled"}</span>}</td><td><ClaimTag tag={r.tag} tags={story.tags} /></td></tr>)}</tbody>
        </table></div>
      </section>
      <section className="panel" aria-labelledby="obo-facts-h">
        <h2 id="obo-facts-h">What we know, and how well</h2>
        <ul className="facts" data-testid="obo-facts">
          {story.facts.map((f) => <li key={f.id}><ClaimTag tag={f.tag} tags={story.tags} /> {f.text} <span className="muted">Source: {f.source}.</span></li>)}
        </ul>
      </section>
      <WhyItMatters why={story.why} />
    </div>
  );
}
