import { useCallback, useEffect, useRef, useState } from "react";
import Json from "./Json";
import ClaimTag, { TagLegend } from "./ClaimTag";
import { evaluateThreeLo, getJson } from "../api";
import { visible } from "../safeText";

const CHECK_WORD = { true: "passed", false: "failed", null: "not reached" };

function Verdict({ run }) {
  if (!run) return null;
  const allow = run.decision === "allow";
  return (
    <div className={`verdict verdict--${allow ? "allow" : "deny"}`} data-testid="tl-verdict" role="status">
      <strong className="verdict__word">{allow ? "ALLOW" : "DENY"}</strong> <span>{run.code ? `error: ${visible(run.code)}` : "every step lined up"}</span>
      <ul className="verdict__reasons" data-testid="tl-checks">
        {run.checks.map((c) => <li key={c.id} data-state={String(c.ok)}><code>{c.id}</code>: {CHECK_WORD[String(c.ok)]}. {visible(c.label)}</li>)}
      </ul>
      {run.detail && <p className="muted" data-testid="tl-detail">{visible(run.detail)}</p>}
      {run.token && (
        <div data-testid="tl-token">
          <h3>The token the agent received</h3>
          <Json value={run.token} />
        </div>
      )}
      {run.user && <p data-testid="tl-user">The human who signed in: <code>{visible(run.user.name)}</code> (sub <code>{visible(run.user.sub)}</code>).</p>}
    </div>
  );
}

export default function ThreeLo({ vertical, resetSignal }) {
  const [story, setStory] = useState(null);
  const [error, setError] = useState(null);
  const [id, setId] = useState(null);
  const [run, setRun] = useState(null);
  const [fail, setFail] = useState(null);
  const seq = useRef(0);

  useEffect(() => {
    let live = true;
    getJson(`/api/three-lo?vertical=${encodeURIComponent(vertical)}`).then((j) => { if (live) { setStory(j); setId(j.scenarios[0].id); setError(null); } }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [vertical]);

  const exec = useCallback(async (sid) => {
    const mine = ++seq.current; setFail(null);
    const out = await evaluateThreeLo({ scenario: sid }).catch(() => ({ ok: false, status: 0, body: {} }));
    if (mine !== seq.current) return; // a newer request is in flight: this answer is stale
    if (out.ok) setRun(out.body); else { setRun(null); setFail(`Could not evaluate (${out.body.error || out.status}${out.body.detail ? `: ${out.body.detail}` : ""}).`); }
  }, []);

  useEffect(() => { if (id) exec(id); }, [id, resetSignal, exec]);

  if (error) return <p className="field-error" role="alert">Could not load the USER_FEDERATION tab ({error}).</p>;
  if (!story || !id) return <p className="muted">Loading...</p>;
  const tags = { measured: "measured (our note)", invented: "lab-invented" };
  return (
    <div className="gate release-tab" data-testid="three-lo-tab">
      <section className="panel">
        <h2>{story.title}</h2>
        <p>{story.intro}</p>
        <TagLegend tags={tags} />
      </section>
      <section className="panel">
        <h3>The flow, step by step</h3>
        <ol className="steps" data-testid="tl-steps">
          {story.steps.map((s) => <li key={s.id}><strong>{s.label}.</strong> {visible(s.detail)}</li>)}
        </ol>
      </section>
      <section className="panel">
        <h3>Run a scenario</h3>
        <div className="seg" role="group" aria-label="Scenario">
          {story.scenarios.map((s) => <button key={s.id} type="button" aria-pressed={id === s.id} onClick={() => setId(s.id)} data-testid={`tl-${s.id}`}>{s.title}</button>)}
        </div>
        <Verdict run={run} />
        {fail && <p className="field-error" role="alert">{fail}</p>}
        {run && run.lesson && <p className="lesson" data-testid="tl-lesson">{visible(run.lesson)}</p>}
      </section>
      <section className="panel">
        <h3>The two configured shapes</h3>
        <div className="cols">
          <div>
            <h4>PingOne worker app (mock)</h4>
            <dl className="kv" data-testid="tl-app">
              <dt>clientId</dt><dd><code>{visible(story.pingoneApp.clientId)}</code></dd>
              <dt>redirectUri</dt><dd><code>{visible(story.pingoneApp.redirectUri)}</code></dd>
              <dt>tokenEndpointAuthMethod</dt><dd><code>{visible(story.pingoneApp.tokenEndpointAuthMethod)}</code></dd>
              <dt>scopes</dt><dd><code>{visible(story.pingoneApp.scopes.join(" "))}</code></dd>
            </dl>
          </div>
          <div>
            <h4>AgentCore credential provider (mock)</h4>
            <dl className="kv" data-testid="tl-provider">
              <dt>name</dt><dd><code>{visible(story.credentialProvider.name)}</code></dd>
              <dt>type</dt><dd><code>{visible(story.credentialProvider.type)}</code></dd>
              <dt>oauth2Flow</dt><dd><code>{visible(story.credentialProvider.oauth2Flow)}</code></dd>
              <dt>callbackUrl</dt><dd><code>{visible(story.credentialProvider.callbackUrl)}</code></dd>
              <dt>pre-registered sessionUri</dt><dd><code>{visible(story.preRegistered[0].sessionUri)}</code></dd>
            </dl>
          </div>
        </div>
      </section>
      <section className="panel">
        <h3>What each claim means, and how well we know it</h3>
        <table className="table" data-testid="tl-claims">
          <thead><tr><th scope="col">Claim</th><th scope="col">Tag</th><th scope="col">Note</th></tr></thead>
          <tbody>
            {story.claimRows.map((r) => (
              <tr key={r.claim}><td><code>{visible(r.claim)}</code></td><td><ClaimTag tag={r.tag} tags={tags} /></td><td>{visible(r.note)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h3>Facts, each with its source</h3>
        <ul className="facts" data-testid="tl-facts">
          {story.facts.map((f) => <li key={f.id}><ClaimTag tag={f.tag} tags={tags} /> {visible(f.text)} <span className="muted">({visible(f.source)})</span></li>)}
        </ul>
      </section>
    </div>
  );
}
