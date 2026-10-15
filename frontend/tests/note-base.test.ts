import { describe, expect, it } from "vitest";
import { noteBase } from "@/lib/note-base";

// Each hash computed by the backend: sha256 of `frontmatter.unstamped(text)`
// encoded as UTF-8. The two sides only agree while they cut and encode alike.
const VECTORS: [string, string][] = [
  ["plain body\n", "9d524694c83e40b4f54579a352f55a6422df42b882e3ea80699bd8754ed79be0"],
  [
    "---\nid: a\nmodified: 2026-10-15T08:00:00+00:00\ntype: Note\n---\nBody mit Umlaut äöü und Emoji 🦊\n",
    "2ffc87b655c6bff3f55d1fa983ea2d732c06cbb1a78113485ae5220b1922bf7a",
  ],
  [
    "---\nid: b\n---\nmodified: stays in the body\n",
    "2771ea35fac3bf8270acd72a74a58983361d15648d6f0ab03b3399edf7d8dc47",
  ],
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
];

describe("noteBase", () => {
  it("hashes a note the way the backend hashes its base", () => {
    for (const [text, hash] of VECTORS) expect(noteBase(text)).toBe(hash);
  });

  it("sets the modified line aside, and only that line", () => {
    const at = (when: string) => `---\nid: a\nmodified: ${when}\n---\nbody\n`;
    expect(noteBase(at("2026-10-15T08:00:00+00:00"))).toBe(
      noteBase(at("2026-10-15T09:30:00+00:00")),
    );
    expect(noteBase("---\nid: a\n---\nbody\n")).not.toBe(noteBase("---\nid: b\n---\nbody\n"));
  });
});
