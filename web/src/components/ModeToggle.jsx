import React from "react";

// Mock / Real switch in the header of every page (rule 19). Pressed = current mode. Real is disabled with the
// server's how-to tooltip until the owner configures the key. Switching POSTs /api/mode then reloads all data.
export default function ModeToggle({ info, onSelect }) {
  const loading = !info;
  const source = info?.source;
  const realOff = loading || info.realAvailable !== true;
  const reason = realOff && !loading ? info.realReason || "Real mode is not available." : undefined;
  const pick = (next) => { if (next !== source) onSelect?.(next); };
  return (
    <div className="mode-toggle" role="group" aria-label="Mode" data-testid="mode">
      <button type="button" className="btn small" aria-pressed={source === "mock"} disabled={loading} onClick={() => pick("mock")} data-testid="mode-mock">Mock</button>
      <button type="button" className="btn small" aria-pressed={source === "real"} disabled={realOff} title={reason} onClick={() => pick("real")} data-testid="mode-real">Real</button>
    </div>
  );
}
