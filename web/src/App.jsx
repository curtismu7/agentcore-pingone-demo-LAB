import { useCallback, useEffect, useRef, useState } from "react";
import ClaimGate from "./components/ClaimGate";
import ThreeLo from "./components/ThreeLo";
import OnBehalfOf from "./components/OnBehalfOf";
import ErrorBoundary from "./components/ErrorBoundary";
import DiagramTab from "./components/DiagramTab";
import TalkTrack from "./components/TalkTrack";
import RealRun from "./components/RealRun";
import { getJson, resetWorkspace, requestModeSwitch } from "./api";
import { NO_LIVE, RELEASE_BANNER } from "./releaseText";
import ShelfLink from "./components/ShelfLink.jsx";
import VerifyMark from "./components/VerifyMark.jsx";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";
import TalkTrackDialog from "./talk-track/TalkTrackDialog.jsx";
import HelpDialog from "./help-dialog/HelpDialog.jsx";
import { HELP_SECTIONS } from "./helpContent";
import talkMd from "../../docs/talk-track.md?raw";

const THEME_KEY = "agentcore.theme";
const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];
const FONT_KEY = "agentcore.font";
function initialFont() {
  try { const f = localStorage.getItem(FONT_KEY); if (["S", "M", "L"].includes(f)) return f; } catch { /* storage blocked */ }
  return "M";
}
function initialTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (t === "light" || t === "dark") return t; } catch { /* storage blocked */ }
  return "auto";
}

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
  const [talkOpen, setTalkOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const talkSteps = (() => {
    const steps = []; let n = 0;
    for (const line of talkMd.split("\n")) {
      const m = line.match(/^\d+\.\s+(?:"(.+?)"|\*\*(.+?)\.\*\*\s*(.*))$/);
      if (m) { n += 1; steps.push({ id: `s${n}`, title: (m[1] || m[2]).slice(0, 60), say: m[1] || m[3] }); }
    }
    return steps.length ? steps : [{ id: "s1", title: "Talk track", say: talkMd.slice(0, 600) }];
  })();
  const [story, setStory] = useState(null);
  const [info, setInfo] = useState(undefined); // undefined = loading, null = failed
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(hashParts().tab);
  const [requested, setRequested] = useState(hashParts().scenario);
  const [lastRun, setLastRun] = useState(null); // the gate tab's last run; the diagram tab shows its hops in the expanded boxes
  const [presenter, setPresenter] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [resetMsg, setResetMsg] = useState("");
  const [theme, setTheme] = useState(initialTheme);
  const [fontStep, setFontStep] = useState(initialFont);
  const pickTheme = (next) => {
    try { if (next === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    setTheme(next);
  };
  // The picker only sets data-theme; the shared stylesheet does the rest ("auto" follows the system setting).
  useEffect(() => { if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    applyFontSize(fontStep);
    try { localStorage.setItem(FONT_KEY, fontStep); } catch { /* not remembered */ }
  }, [fontStep]);

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
    if (next === (info?.source ?? "mock")) return; // picking the current mode is a no-op, not a request
    try {
      const r = await requestModeSwitch(next);
      setInfo(r);
      setResetSignal((n) => n + 1); // reload all data after a switch (rule 19)
    } catch (e) { /* Real unconfigured: the toggle stays on Mock; the button's tooltip carries the how-to */ }
  }, [info?.source]);

  const reset = useCallback(async () => {
    const ok = await resetWorkspace().catch(() => false);
    setResetSignal((n) => n + 1);
    setResetMsg(ok ? "Reset: your workspace's evaluations are cleared, the modelled gateway is back as it was, and the diagram boxes are back in place." : "Reset failed on the server; the view was reset.");
  }, []);

  const banner = info?.source === "real"
    ? "REAL mode: the Real tab mints a live PingOne token through AWS AgentCore Identity. The scenario gate is still the mock model; the token on the Real tab is real and short-lived."
    : story ? story.banner : BANNER_UNKNOWN;
  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">AC</span>
          <h1>AgentCore PingOne LAB</h1>
          {info?.source === "real"
            ? <span className="shell-badge shell-badge--real" data-testid="mode-badge">Real</span>
            : <span className="shell-badge" data-testid="mode-badge">Mock</span>}
        </span>
        <nav className="shell-nav" aria-label="Lab sections">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} aria-current={tab === t.id ? "page" : undefined}
              onClick={(e) => { e.preventDefault(); select(t.id); }}>{t.label}</a>
          ))}
        </nav>
        <TopMenu
          mode={info ? { value: info.source === "real" ? "real" : "mock", onChange: onMode, realAvailable: info.realAvailable === true, realHint: info.realReason || "Real mode is not available." } : undefined}
          vertical={{ value: vertical, onChange: setVertical, options: story ? story.verticals : ["retail"] }}
          theme={{ value: theme, onChange: pickTheme }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          present={{ active: presenter, onToggle: () => setPresenter((v) => !v), label: "Presenter (P)" }}
          talkTrack={{ active: talkOpen, onToggle: () => setTalkOpen((v) => !v) }}
          help={{ onClick: () => setHelpOpen(true), title: "What this lab is, and what is simulated" }}
          version={info?.version || null}
          onReset={reset}
        >
          <ShelfLink />
          <VerifyMark id="agentcore-pingone-demo-lab" />
        </TopMenu>
      </header>
      <main className="page">
        <p className="banner" role="status" data-state="mock" data-testid="banner">{banner}</p>
        {error && <p className="app-error" role="alert">Could not load the lab ({error}). Is the server running?</p>}
        <p className="sr-only" role="status" aria-live="polite">{resetMsg}</p>
        {!presenter && story && <p className="intro page-intro">{story.intro}</p>}
        <div id={`panel-${tab}`} className="page-panel" data-testid="panel">
          {RELEASE_TABS.includes(tab) && <p className="banner banner--release" role="note" data-testid="release-banner">{RELEASE_BANNER}</p>}
          <ErrorBoundary resetKey={`${tab}|${vertical}`}>
          {error ? null : !story ? <p className="muted">Loading...</p> : (
            <>
              {presenter && tab !== "talk" && (
                <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
                  {story.talkTrack.filter((t) => (tab === "gate" ? ["say-first", "m2m", "trap", "unverified"] : tab === "three-lo" ? ["three-lo", "three-lo-vs-m2m", "unverified"] : tab === "obo" ? ["obo", "why-obo"] : tab === "real" ? ["say-first", "real-m2m", "real-3lo", "real-contrast"] : ["m2m"]).includes(t.id)).map((t) => <p key={t.id}><strong>{t.title}.</strong> {t.say}</p>)}
                </aside>
              )}
              {tab === "gate" && <ClaimGate key={vertical} story={story} resetSignal={resetSignal} requestedId={requested} onSelect={pickScenario} onRun={setLastRun} />}
              {tab === "three-lo" && <ThreeLo key={vertical} vertical={vertical} resetSignal={resetSignal} />}
              {tab === "obo" && <OnBehalfOf key={vertical} vertical={vertical} resetSignal={resetSignal} />}
              {tab === "real" && <RealRun info={info} />}
              {tab === "diagram" && <DiagramTab vertical={vertical} resetSignal={resetSignal} run={lastRun} />}
              {tab === "talk" && <TalkTrack talk={story.talkTrack} />}
            </>
          )}
          </ErrorBoundary>
        </div>
      <TalkTrackDialog isOpen={talkOpen} onClose={() => setTalkOpen(false)} talk={talkSteps} />
      <HelpDialog isOpen={helpOpen} onClose={() => setHelpOpen(false)} sections={HELP_SECTIONS} docsUrl="https://github.com/curtismu7/agentcore-pingone-demo-LAB#readme" />

      </main>
    </div>
  );
}
