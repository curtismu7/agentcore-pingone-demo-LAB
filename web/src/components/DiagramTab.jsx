import { useEffect, useMemo, useState } from "react";
import PatternDiagram from "./PatternDiagram";
import { getJson } from "../api";

/** The run's hops as the kit's call data, one entry per arrow. Verdict: PERMIT->ok, DENY->deny, else held. */
function hopCalls(run) {
  if (!run || !Array.isArray(run.hops)) return [];
  const verdict = run.decision === "PERMIT" ? "ok" : run.decision === "DENY" ? "deny" : "held";
  return run.hops.map((h) => ({ from: h.from, to: h.to, hop: { title: h.label, fact: h.label, verdict, request: h.request, response: h.response } })).filter((c) => c.from !== c.to);
}

const NAMES = [["m2m-gate", "M2M gate"], ["three-lo", "USER_FEDERATION (3LO)"], ["obo", "On-behalf-of"]];

// Diagrams are diagram-studio/1 data loaded by name from the server (rule 17); nothing is drawn from hand-built nodes here.
export default function DiagramTab({ vertical, resetSignal, run = null }) {
  const [pattern, setPattern] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState("m2m-gate");
  useEffect(() => {
    let live = true; // a late answer for a diagram or vertical the visitor has already left is dropped
    setPattern(null);
    getJson(`/api/diagram?vertical=${encodeURIComponent(vertical)}&name=${name}`).then((j) => { if (live) setPattern(j); }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [vertical, name]);
  // The gate tab's last run's hops ride on the matching arrows: the expanded box shows what went over the wire.
  const withHops = useMemo(() => {
    if (!pattern) return null;
    const calls = hopCalls(run);
    if (!calls.length) return pattern;
    const steps = pattern.steps.map((st) => ({ ...st }));
    let ci = 0;
    for (const st of steps) if (st.from === calls[ci]?.from && st.to === calls[ci]?.to) st.hop = calls[ci++].hop;
    return { ...pattern, steps };
  }, [pattern, run]);
  if (error) return <p className="field-error" role="alert">Could not load the diagram ({error}).</p>;
  return (
    <>
      <div className="seg" role="group" aria-label="Diagram">
        {NAMES.map(([id, label]) => <button key={id} type="button" aria-pressed={name === id} onClick={() => setName(id)} data-testid={`dg-${id}`}>{label}</button>)}
      </div>
      {withHops ? <PatternDiagram key={name} pattern={withHops} resetSignal={resetSignal} /> : <p className="muted">Loading...</p>}
    </>
  );
}
