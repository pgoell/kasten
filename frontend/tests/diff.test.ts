import { lineDiff } from "@/lib/diff";

describe("lineDiff", () => {
  it("marks lines only the vault has and lines only mine has", () => {
    const vault = "# Title\nkept\ntheirs\nend";
    const mine = "# Title\nkept\nmine\nend";

    expect(lineDiff(vault, mine)).toEqual([
      { op: " ", text: "# Title" },
      { op: " ", text: "kept" },
      { op: "-", text: "theirs" },
      { op: "+", text: "mine" },
      { op: " ", text: "end" },
    ]);
  });

  it("ignores the modified stamp", () => {
    const vault = "---\nid: a\nmodified: 2026-10-14T10:00:00Z\n---\n# Title\nbody";
    const mine = "---\nid: a\nmodified: 2026-10-13T09:00:00Z\n---\n# Title\nbody";

    expect(lineDiff(vault, mine).every(({ op }) => op === " ")).toBe(true);
    expect(lineDiff(vault, mine).some(({ text }) => text.startsWith("modified:"))).toBe(false);
  });

  it("keeps both texts whole when the stretch that differs is too long to match line by line", () => {
    const vault = Array.from({ length: 1500 }, (_, at) => `vault ${at}`);
    const mine = Array.from({ length: 1500 }, (_, at) => `mine ${at}`);

    const diff = lineDiff(["# Title", ...vault].join("\n"), ["# Title", ...mine].join("\n"));

    expect(diff[0]).toEqual({ op: " ", text: "# Title" });
    expect(diff.filter(({ op }) => op === "-").map(({ text }) => text)).toEqual(vault);
    expect(diff.filter(({ op }) => op === "+").map(({ text }) => text)).toEqual(mine);
  });
});
