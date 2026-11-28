// The vendored shared/mode-modal files (ModeModal.jsx, mode-modal.css) match mode-modal.sha256 byte for byte. They come from
// curtismu7/AI-DEMO-Standalone shared/mode-modal: change them there, re-pin, re-vendor; never edit them here.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "mode-modal");

describe("vendored mode-modal", () => {
  it("matches mode-modal.sha256 byte for byte, and the pin lists exactly the two shared files", () => {
    const pins = fs.readFileSync(path.join(dir, "mode-modal.sha256"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
    expect(pins.map(([, f]) => f).sort()).toEqual(["ModeModal.jsx", "mode-modal.css"]);
    for (const [hash, file] of pins) expect(createHash("sha256").update(fs.readFileSync(path.join(dir, file))).digest("hex"), file).toBe(hash);
  });
});
