import type { ChangeSpec, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * A pipe table, read off its lines and drawn back with the columns lined up.
 *
 * Line by line rather than through the syntax tree, so `formatDocument` and the
 * tab keys share one reading of what a table is. The parser knows the same
 * thing, but only for as much of the note as it has parsed, and only in a shape
 * that hands back nodes when what both callers want is cells.
 *
 * ponytail: a fence holding a table is a table to this reading.
 * `formatDocument` tracks fences itself and never asks, so only tab is fooled,
 * and it moves the cursor rather than writing. Ask the tree if a note ever
 * teaches markdown.
 */

/** Which side of its column a cell's text sits on, read off the dashes. */
export type Align = "none" | "left" | "right" | "center";

/** A `|` the writer meant as a cell wall rather than as a character. */
const WALL = /(?<!\\)\|/;
/** The same, for the two readings that count walls rather than find one. */
const WALLS = /(?<!\\)\|/g;

/** What a delimiter cell is made of: `---`, `:--`, `--:` or `:-:`. */
const DASHES = /^:?-+:?$/;

/** The narrowest a column can be drawn and still leave a legal `---`. */
const MIN_WIDTH = 3;

/**
 * What pads a cell: spaces and tabs only. `trim()` would also take a no-break
 * or an ideographic space, which the writer typed as text and which must come
 * through a line-up as it went in.
 */
const PADDING = /^[ \t]+|[ \t]+$/g;

/** Its cells, trimmed, with the outer walls dropped. */
function cellsOf(text: string): string[] {
  const inner = text
    .replace(PADDING, "")
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return inner.split(WALLS).map((cell) => cell.replace(PADDING, ""));
}

/** Whether a line is a row of a table: a line carrying a cell wall. */
export function isRow(text: string): boolean {
  return WALL.test(text);
}

/**
 * Whether a line is the row of dashes under a head.
 *
 * Read with `trim()`, not the padding `cellsOf` takes: the tree reads a no-break
 * or an ideographic space beside a dash as whitespace, so the row is a divider
 * there too.
 */
function isDivider(text: string): boolean {
  const cells = text
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(WALLS)
    .map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => DASHES.test(cell));
}

/**
 * How wide a cell draws, in characters.
 *
 * ponytail: code points, so one CJK glyph counts as one column when it occupies
 * two, and a table of Japanese lines up on paper and not on the screen. An East
 * Asian width table is the upgrade, when a note needs it.
 */
function widthOf(text: string): number {
  return [...text].length;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return "none";
}

/**
 * Where each column's text sits, read off a table's row of dashes.
 *
 * For the live preview, which draws the table rather than lining its source up
 * and so needs the alignment on its own.
 */
export function alignsOf(divider: string): Align[] {
  return cellsOf(divider).map(alignOf);
}

/** The note's own line numbers, first and last, both inside the table. */
export interface TableRun {
  first: number;
  last: number;
}

/**
 * The table the given line sits in, or null when it sits in none.
 *
 * The dashes say where the table starts. Walking up from a pipe alone would
 * swallow the paragraph above one, since a line of prose is allowed to carry a
 * `|`, so the header is the line above the first row of dashes and the run
 * begins there.
 */
export function tableAt(doc: Text, at: number): TableRun | null {
  if (!isRow(doc.line(at).text)) return null;

  let first = at;
  while (first > 1 && isRow(doc.line(first - 1).text)) first--;
  let last = at;
  while (last < doc.lines && isRow(doc.line(last + 1).text)) last++;

  let divider = first + 1;
  while (divider <= last && !isDivider(doc.line(divider).text)) divider++;
  if (divider > last || divider - 1 > at) return null;
  return { first: divider - 1, last };
}

interface Grid {
  /** The whitespace the first line opens with, worn by every line drawn. */
  indent: string;
  /** Every row's cells, the dashes among them, padded to one width. */
  rows: string[][];
  aligns: Align[];
}

function readGrid(doc: Text, run: TableRun): Grid {
  const rows: string[][] = [];
  for (let n = run.first; n <= run.last; n++) rows.push(cellsOf(doc.line(n).text));

  // A body row wider than the dashes keeps its extra cells and the table grows
  // a column, rather than being cut back to the header and losing what it says.
  const columns = Math.max(...rows.map((row) => row.length));
  for (const row of rows) while (row.length < columns) row.push("");

  return {
    indent: /^[ \t]*/.exec(doc.line(run.first).text)?.[0] ?? "",
    rows,
    aligns: (rows[1] ?? []).map(alignOf),
  };
}

/** The row of dashes is drawn from the alignment, not from what it held. */
const DIVIDER_ROW = 1;

function columnWidths(grid: Grid): number[] {
  return grid.aligns.map((_, column) =>
    Math.max(
      MIN_WIDTH,
      ...grid.rows.map((row, index) => (index === DIVIDER_ROW ? 0 : widthOf(row[column] ?? ""))),
    ),
  );
}

function pad(text: string, width: number, align: Align): string {
  const gap = width - widthOf(text);
  if (gap <= 0) return text;
  if (align === "right") return " ".repeat(gap) + text;
  if (align !== "center") return text + " ".repeat(gap);
  const left = Math.floor(gap / 2);
  return " ".repeat(left) + text + " ".repeat(gap - left);
}

function dashes(width: number, align: Align): string {
  if (align === "center") return `:${"-".repeat(width - 2)}:`;
  if (align === "left") return `:${"-".repeat(width - 1)}`;
  if (align === "right") return `${"-".repeat(width - 1)}:`;
  return "-".repeat(width);
}

/**
 * Every row drawn to the same widths, so each line comes out the same length.
 *
 * That is what lets `moveCell` find a cell by arithmetic instead of by
 * searching the text it just wrote.
 */
function draw(grid: Grid, widths: number[]): string {
  return grid.rows
    .map((row, index) => {
      const cells = widths.map((width, column) => {
        const align = grid.aligns[column] ?? "none";
        return index === DIVIDER_ROW ? dashes(width, align) : pad(row[column] ?? "", width, align);
      });
      return `${grid.indent}| ${cells.join(" | ")} |`;
    })
    .join("\n");
}

/** The table's lines redrawn with its columns lined up. */
export function alignTable(doc: Text, run: TableRun): string {
  const grid = readGrid(doc, run);
  return draw(grid, columnWidths(grid));
}

/**
 * The edits that take a table's lines to where `alignTable` draws them.
 *
 * Kept as small as they can be. A line that differs only in spaces gets spaces
 * put in or taken out, so a cursor in a cell still sits on the character it sat
 * on. Any other difference replaces only the middle of the line, so the text of
 * a cell, its escapes and its dashes come through as they were typed.
 */
export function lineUpChanges(doc: Text, run: TableRun): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  alignTable(doc, run)
    .split("\n")
    .forEach((want, index) => {
      const line = doc.line(run.first + index);
      const old = line.text;
      if (want === old) return;

      if (old.replace(/ /g, "") === want.replace(/ /g, "")) {
        changes.push(...spacesBetween(line.from, old, want));
        return;
      }
      let head = 0;
      while (head < old.length && head < want.length && old[head] === want[head]) head++;
      let tail = 0;
      while (
        tail < old.length - head &&
        tail < want.length - head &&
        old[old.length - 1 - tail] === want[want.length - 1 - tail]
      ) {
        tail++;
      }
      changes.push({
        from: line.from + head,
        to: line.from + old.length - tail,
        insert: want.slice(head, want.length - tail),
      });
    });
  return changes;
}

/** The space-only edits from `old` to `want`, which have the same non-spaces. */
function spacesBetween(from: number, old: string, want: string): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  let i = 0;
  let j = 0;
  while (i < old.length || j < want.length) {
    if (i < old.length && j < want.length && old[i] === want[j]) {
      i++;
      j++;
    } else if (j < want.length && want[j] === " ") {
      changes.push({ from: from + i, insert: " " });
      j++;
    } else {
      changes.push({ from: from + i, to: from + i + 1 });
      i++;
    }
  }
  return changes;
}

/** Which cell a position on a row falls in, counting the walls to its left. */
function columnAt(text: string, at: number): number {
  const walls = text.slice(0, at).match(WALLS)?.length ?? 0;
  // A row that opens with a wall carries one more of them before every cell
  // than a row that does not.
  return Math.max(0, walls - (text.trimStart().startsWith("|") ? 1 : 0));
}

/**
 * Moves the cursor one cell along, lining the table up on the way.
 *
 * `step` is 1 for the next cell and -1 for the one before. Returns false when
 * the cursor is not in a table, or is in the first cell of one and going back,
 * which is what leaves tab to indent the way it does everywhere else.
 *
 * The table is rewritten on every press rather than only on `<leader>=`, so a
 * cell that has just been typed into is squared up before the cursor leaves it.
 */
export function moveCell(view: EditorView, step: 1 | -1): boolean {
  const { state } = view;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const run = tableAt(state.doc, line.number);
  if (run === null) return false;

  const grid = readGrid(state.doc, run);
  const columns = grid.aligns.length;
  let row = line.number - run.first;
  let column = Math.min(columnAt(line.text, head - line.from), columns - 1) + step;

  if (column < 0) {
    row--;
    column = columns - 1;
  } else if (column >= columns) {
    row++;
    column = 0;
  }
  // The dashes are nobody's cell, so the walk steps over the row of them.
  if (row === DIVIDER_ROW) {
    row += step;
    column = step > 0 ? 0 : columns - 1;
  }
  if (row < 0) return false;
  // Past the last row is an invitation to write one, which is how a table grows.
  if (row >= grid.rows.length) grid.rows.push(new Array<string>(columns).fill(""));

  const widths = columnWidths(grid);
  const stride = (column: number) =>
    widths.slice(0, column).reduce((sum, width) => sum + width + 3, 0);
  const from = state.doc.line(run.first).from;
  // Every drawn line is `indent | cells... |`, one character for the opening
  // wall and one for the newline.
  const lineWidth = grid.indent.length + 1 + stride(columns);
  const at = row * (lineWidth + 1) + grid.indent.length + 2 + stride(column);

  const to = state.doc.line(run.last).to;
  const drawn = draw(grid, widths);
  view.dispatch({
    // A table already square is left alone, so walking one is a move and not
    // an edit: no undo step per press, and no write of a file nothing changed.
    changes: drawn === state.doc.sliceString(from, to) ? undefined : { from, to, insert: drawn },
    selection: { anchor: from + at },
  });
  return true;
}
