import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import App from "./App.jsx";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy
// that call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
const ID = "agentcore-pingone-demo-lab"; // docs/shelf-entry.json

const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
function withShelf(payload) {
  globalThis.fetch = vi.fn(async (url) => {
    const body = url === "/api/shelf" ? payload : {};
    return new Response(JSON.stringify(body), { status: url === "/api/shelf" ? 200 : 404, headers: { "content-type": "application/json" } });
  });
}
beforeEach(() => { window.location.hash = ""; });
afterEach(() => { vi.restoreAllMocks(); });

describe("verification mark in the header", () => {
  it("uses the id in docs/shelf-entry.json", () => {
    const entry = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "docs", "shelf-entry.json"), "utf8")).demos[0];
    expect(entry.id).toBe(ID);
  });

  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    withShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: ID, verification: mark("verified", "Verified", { note: "Every flow run on the mock" }) }] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every flow run on the mock"));
  });

  it("shows nothing when the lab is opened on its own port (its /api/shelf has no demos) or the shelf has no mark for it", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: ID, verification: null }] }]) {
      withShelf(payload);
      const { unmount } = render(<App />);
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });

  it("the header renders the badge from App.jsx (removing the line fails this test)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "App.jsx"), "utf8");
    expect(src.match(/<VerifyMark\s+id="agentcore-pingone-demo-lab"\s*\/>/g)).toHaveLength(1);
  });
});
