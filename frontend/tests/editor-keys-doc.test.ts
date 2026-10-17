import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TODO_PANE } from "@/lib/key-bindings";

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
