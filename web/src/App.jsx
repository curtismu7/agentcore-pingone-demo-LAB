import { useCallback, useEffect, useRef, useState } from "react";
import ClaimGate from "./components/ClaimGate";
import ThreeLo from "./components/ThreeLo";
import OnBehalfOf from "./components/OnBehalfOf";
import ErrorBoundary from "./components/ErrorBoundary";
import DiagramTab from "./components/DiagramTab";
import TalkTrack from "./components/TalkTrack";
import RealRun from "./components/RealRun";
import ModeToggle from "./components/ModeToggle";
import { getJson, resetWorkspace, requestModeSwitch } from "./api";
import { NO_LIVE, RELEASE_BANNER } from "./releaseText";

export const TABS = [
  { id: "gate", label: "M2M gate" },
  { id: "three-lo", label: "USER_FEDERATION (3LO)" },
  { id: "obo", label: "On-behalf-of" },
  { id: "real", label: "Real" },
  { id: "diagram", label: "Diagram" },
  { id: "talk", label: "Talk track" },
];
// The two H2 2026 release tabs carry their own banner on top of the simulation banner, in presenter mode too.
export const RELEASE_TABS = ["obo"];
// The banner is never blank: until /api/scenarios answers (or if it fails) this fixed text stands in. It names the mode, always mock here.
const TAIL = "Nothing here calls a real gateway, identity provider or tenant.";
export const BANNER_UNKNOWN = `SIMULATED, MOCK mode: a mock PingOne token and mock AgentCore checks. ${TAIL}`;

const hashParts = () => {
  const h = window.location.hash.replace("#", "");
  const m = /^scenario-([a-z0-9-]{1,40})$/.exec(h);
  if (m) return { tab: "gate", scenario: m[1] };
  return { tab: TABS.some((t) => t.id === h) ? h : "gate", scenario: null };
};

export default function App() {
  const [vertical, setVertical] = useState("retail");
  const [story, setStory] = useState(null);
  const [info, setInfo] = useState(undefined); // undefined = loading, null = failed
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(hashParts().tab);
  const [requested, setRequested] = useState(hashParts().scenario);
  const [presenter, setPresenter] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [resetMsg, setResetMsg] = useState("");
  const tabsRef = useRef(null);

  useEffect(() => { getJson("/api/info").then(setInfo, () => setInfo(null)); }, []);
  const storySeq = useRef(0);
  useEffect(() => {
    const mine = ++storySeq.current;
    getJson(`/api/scenarios?vertical=${encodeURIComponent(vertical)}`).then((j) => { if (mine === storySeq.current) { setStory(j); setError(null); } }, (e) => { if (mine === storySeq.current) setError(e.message); });
  }, [vertical]);
  useEffect(() => {
    const on = () => { const p = hashParts(); setTab(p.tab); setRequested(p.scenario); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const select = (id) => { setTab(id); setRequested(null); try { window.history.replaceState(null, "", `#${id}`); } catch { /* ignore */ } };
  const pickScenario = (sid) => { try { window.history.replaceState(null, "", `#scenario-${sid}`); } catch { /* ignore */ } };

  // Keep the active tab fully in view in the scrolling tab strip (375px).
  useEffect(() => {
    const strip = tabsRef.current; const el = document.getElementById(`tab-${tab}`);
    if (!strip || !el) return;
    const left = el.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, left - 8);
  }, [tab]);

  useEffect(() => {
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // Cmd/Ctrl/Alt + P is the browser's (print), not ours
      if (e.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const onMode = useCallback(async (next) => {
    try {
      const r = await requestModeSwitch(next);
      setInfo(r);
      setResetSignal((n) => n + 1); // reload all data after a switch (rule 19)
    } catch (e) { /* Real unconfigured: the toggle stays on Mock; the button's tooltip carries the how-to */ }
  }, []);

  const reset = useCallback(async () => {
    const ok = await resetWorkspace().catch(() => false);
    setResetSignal((n) => n + 1);
    setResetMsg(ok ? "Reset: your workspace's evaluations are cleared, the modelled gateway is back as it was, and the diagram boxes are back in place." : "Reset failed on the server; the view was reset.");
  }, []);

  const onKeyTab = (e, i) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    select(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  const banner = info?.source === "real"
    ? "REAL mode: the Real tab mints a live PingOne token through AWS AgentCore Identity. The scenario gate is still the mock model; the token on the Real tab is real and short-lived."
    : story ? story.banner : BANNER_UNKNOWN;
  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header>
        <p className="banner" role="status" data-state="mock" data-testid="banner">{banner}</p>
        <div className="head">
          <div>
            <h1 className="head__title">AgentCore PingOne LAB</h1>
            {!presenter && story && <p className="head__intro">{story.intro}</p>}
          </div>
          <div className="head__tools">
            <ModeToggle info={info} onSelect={onMode} />
            {!presenter && (
              <label className="inline">Vertical{" "}
                <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
                  {(story ? story.verticals : ["retail"]).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            )}
            <button type="button" onClick={reset} data-testid="reset">Reset</button>
            <button type="button" aria-pressed={presenter} onClick={() => setPresenter((v) => !v)} data-testid="presenter">{presenter ? "Exit presenter (Esc)" : "Presenter (P)"}</button>
          </div>
        </div>
      </header>
      <main>
        <p className="sr-only" role="status" aria-live="polite">{resetMsg}</p>
        <div role="tablist" aria-label="Lab sections" className="tabs" ref={tabsRef}>
          {TABS.map((t, i) => (
            <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
              onClick={() => select(t.id)} onKeyDown={(e) => onKeyTab(e, i)}>{t.label}</button>
          ))}
        </div>
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {RELEASE_TABS.includes(tab) && <p className="banner banner--release" role="note" data-testid="release-banner">{RELEASE_BANNER}</p>}
          <ErrorBoundary resetKey={`${tab}|${vertical}`}>
          {error ? <p className="app-error" role="alert">Could not load the lab ({error}). Is the server running?</p> : !story ? <p className="muted">Loading...</p> : (
            <>
              {presenter && tab !== "talk" && (
                <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
                  {story.talkTrack.filter((t) => (tab === "gate" ? ["say-first", "m2m", "trap", "unverified"] : tab === "three-lo" ? ["three-lo", "three-lo-vs-m2m", "unverified"] : tab === "obo" ? ["obo", "why-obo"] : ["m2m"]).includes(t.id)).map((t) => <p key={t.id}><strong>{t.title}.</strong> {t.say}</p>)}
                </aside>
              )}
              {tab === "gate" && <ClaimGate key={vertical} story={story} resetSignal={resetSignal} requestedId={requested} onSelect={pickScenario} />}
              {tab === "three-lo" && <ThreeLo key={vertical} vertical={vertical} resetSignal={resetSignal} />}
              {tab === "obo" && <OnBehalfOf key={vertical} vertical={vertical} resetSignal={resetSignal} />}
              {tab === "real" && <RealRun info={info} />}
              {tab === "diagram" && <DiagramTab vertical={vertical} resetSignal={resetSignal} />}
              {tab === "talk" && <TalkTrack talk={story.talkTrack} />}
            </>
          )}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
