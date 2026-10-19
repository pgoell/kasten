import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LEADER, LEADER_EDITS, TODO_PANE } from "@/lib/key-bindings";

/**
 * The reference page, read off the file rather than copied, so the panel's
 * table and the page's table are held to each other and not to a third list.
 */
const PAGE = readFileSync("../docs/reference/editor-keys.md", "utf-8");

/** The text from a heading line to the next heading of its level or above. */
function section(heading: string): string {
  const start = PAGE.indexOf(`\n${heading}\n`);
  expect(start).toBeGreaterThan(-1);
  // The count of `#` before the first space.
  const level = heading.indexOf(" ");
  const rest = PAGE.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`\\n#{1,${level}} `));
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The keys a table's rows name, one set per row.
 *
 * A first cell such as `` `O` `P` `X` `` names several keys and Enter names one
 * without backticks, so the backticked words are read where there are any and
 * the bare cell where there are none.
 */
function rows(text: string): Set<string>[] {
  return text
    .split("\n")
    .filter(
      (line) => line.startsWith("| ") && !line.startsWith("| ---") && !line.startsWith("| Key"),
    )
    .map((line) => {
      const cell = line.slice(1, line.indexOf("|", 1)).trim();
      const ticked = [...cell.matchAll(/`([^`]+)`/g)].flatMap((match) => match.slice(1, 2));
      return new Set(ticked.length > 0 ? ticked : [cell]);
    });
}

/** `j / k` on the panel is two keys, as the page writes it. */
function presses(key: string): string[] {
  return key.split(" / ");
}

describe("the todo pane on the reference page", () => {
  it("#419 lists every todo pane key the panel lists, and the panel every board key", () => {
    const pane = section("## The todo pane");
    const board = section("### The board");
    const list = rows(pane.slice(0, pane.indexOf("\n### The board\n")));
    const boardRows = rows(board);

    // Each panel row in the table it belongs to: a key only the board takes in
    // the board's table, every other one in the list's.
    for (const { key, label } of TODO_PANE) {
      const table = label.startsWith("On the board") ? boardRows : list;
      for (const press of presses(key)) {
        expect(
          table.some((row) => row.has(press)),
          `${press} has no row in its table`,
        ).toBe(true);
      }
    }

    // And back: a key the board takes that the panel never names is a key
    // found only by reading this page, which is how `c` went unnoticed.
    const named = new Set(TODO_PANE.flatMap(({ key }) => presses(key)));
    for (const row of boardRows) {
      for (const press of row) {
        expect(named, `${press} is on the board but not on the panel`).toContain(press);
      }
    }
  });
});

/**
 * The groups of the `<leader>?` panel, written out here so the page is held to
 * them (#516). The tab row names `<leader>1` to `<leader>0`, so Tabs ends in
 * those two.
 */
const LEADER_GROUPS: Record<string, string[]> = {
  Panes: ["%", '"', "h", "j", "k", "l", "H", "J", "K", "L", "o", "z", "q"],
  Tabs: ["ct", "tl", "th", "1", "0"],
  Find: ["fb", "ff", "fg", "ft"],
  "Create and capture": ["cf", "cd", "cw", "cm", "cb", "ci", "cv", "cc", "cs"],
  "This note": ["rf", "df", "du", "w", "="],
  "Periodic notes": ["gd", "gw", "gm", "gq", "gy"],
  "Panes to open": ["gb", "go", "gr", "gc", "gp", "gh", "gl", "gv", "ge", "gs", "gt", "gg"],
  Todos: ["x", "i", "@", "so", "sp", "sx", "sb", "sw", "sv", "sr"],
  Toggles: ["a", "b", "p", "e", "E", "v"],
  Help: ["?", ":"],
};

describe("the deck folds on the reference pages (#517)", () => {
  it("#517 A6 both key tables name za and the import guide names the Import entry", () => {
    const format = readFileSync("../docs/reference/flashcard-format.md", "utf-8");
    const sitting = format.slice(format.indexOf("\n## Sitting one\n"));
    const formatKeys = rows(sitting.slice(0, sitting.indexOf("\n### ")));
    const guide = readFileSync("../docs/how-to/import-an-anki-deck.md", "utf-8");
    const importIt = guide.slice(
      guide.indexOf("\n## Import it\n"),
      guide.indexOf("\n## From a link\n"),
    );

    // Soft, so a page that misses one still reports the other two.
    expect
      .soft(
        formatKeys.some((row) => row.has("za")),
        "flashcard-format.md",
      )
      .toBe(true);
    expect
      .soft(
        rows(section("## The review pane")).some((row) => row.has("za")),
        "editor-keys.md",
      )
      .toBe(true);
    expect.soft(importIt, "import-an-anki-deck.md").toContain("**Import**");
  });
});

describe("the leader keys on the reference page", () => {
  it("the editor keys page groups the leader keys as the panel does", () => {
    const leader = section("## Leader");
    const documented = new Map<string, Set<string>>();
    for (const title of Object.keys(LEADER_GROUPS)) {
      const label = `\n**${title}**\n\n`;
      const start = leader.indexOf(label);
      expect(start, `no **${title}** label under ## Leader`).toBeGreaterThan(-1);
      const table = leader.slice(start + label.length);
      const end = table.indexOf("\n\n");
      const keys = rows(end === -1 ? table : table.slice(0, end))
        .flatMap((row) => [...row])
        .map((key) => key.replace(/^<leader>/, ""));
      documented.set(title, new Set(keys));
      expect.soft(new Set(keys), title).toEqual(new Set(LEADER_GROUPS[title]));
    }

    // A binding added to the code but not to the page fails here.
    for (const { key } of [...LEADER, ...LEADER_EDITS]) {
      const homes = [...documented].filter(([, keys]) => keys.has(key)).map(([title]) => title);
      expect(homes, `<leader>${key} is in ${homes.length} groups`).toHaveLength(1);
    }
  });
});
