import { syntaxTree } from "@codemirror/language";
import type { ChangeSpec, EditorState, Line, SelectionRange, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { belowFrontmatter } from "@/lib/markdown/frontmatter-language";
import { alignTable, tableAt } from "@/lib/notes/editor/table";

export interface MarkSpec {
  open: string;
  close: string;
  /** The lezer node name the wrapped text parses to. */
  node: string;
}

export const BOLD: MarkSpec = { open: "**", close: "**", node: "StrongEmphasis" };
export const ITALIC: MarkSpec = { open: "*", close: "*", node: "Emphasis" };
export const STRIKE: MarkSpec = { open: "~~", close: "~~", node: "Strikethrough" };
export const HIGHLIGHT: MarkSpec = { open: "==", close: "==", node: "Highlight" };

/**
 * The marked node the cursor sits inside, or null. Walks up from the innermost node,
 * so italics inside bold answer for themselves, not their parent.
 */
function enclosing(state: EditorState, at: number, node: string) {
  let found: SyntaxNode | null = syntaxTree(state).resolveInner(at, 0);

  while (found) {
    if (found.name === node) return { from: found.from, to: found.to };
    found = found.parent;
  }
  return null;
}

/**
 * Adds or removes one pair of marks around the selection, or the word under the cursor.
 * On a blank line it opens an empty pair with the cursor between. Returns whether it changed the document.
 */
export function toggleMark(view: EditorView, spec: MarkSpec): boolean {
  const { state } = view;
  const range = state.selection.main;
  const marked = enclosing(state, range.head, spec.node);

  if (marked) {
    view.dispatch({
      changes: [
        { from: marked.from, to: marked.from + spec.open.length },
        { from: marked.to - spec.close.length, to: marked.to },
      ],
    });
    return true;
  }

  const target: SelectionRange | null = range.empty ? state.wordAt(range.head) : range;
  const from = target?.from ?? range.head;
  const to = target?.to ?? range.head;

  view.dispatch({
    changes: [
      { from, insert: spec.open },
      { from: to, insert: spec.close },
    ],
    // Inside the marks either way. An empty pair is an invitation to type, and
    // a wrapped word has to stay where a second press can still see the mark,
    // or the key stops being a toggle.
    selection: { anchor: to + spec.open.length },
  });
  return true;
}

const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^#{1,6}\s/;
/** A bullet written with the markers this rewrites, and the space after it. */
const BULLET = /^(\s*)[*+](\s)/;

/** Where the line-by-line tidy stands, and the changes it has gathered. */
interface Tidy {
  /** From `frontEnd`. */
  front: number;
  inFence: boolean;
  blanks: number;
  seen: number;
  changes: ChangeSpec[];
}

/**
 * Tidies the note line by line, one change per line, so CodeMirror maps the cursor through them.
 * Frontmatter and fences are stepped over; tables are left to table.ts. Returns whether anything moved.
 */
export function formatDocument(view: EditorView): boolean {
  const { doc } = view.state;
  const tidy: Tidy = {
    front: frontEnd(doc),
    inFence: false,
    blanks: 0,
    seen: 0,
    changes: [],
  };
  for (let n = 1; n <= doc.lines; n++) n = tidyLine(doc, n, tidy);

  if (tidy.changes.length === 0) return false;
  view.dispatch({ changes: tidy.changes });
  return true;
}

/** The line of the block's closing fence, or 0 with no block. */
function frontEnd(doc: Text): number {
  const below = belowFrontmatter(doc.toString());
  return below === 0 ? 0 : doc.lineAt(below - 1).number;
}

/** Tidies line `n` and returns the last line it covered, a table's last when it took one. */
function tidyLine(doc: Text, n: number, tidy: Tidy): number {
  const line = doc.line(n);
  tidy.seen++;

  if (n <= tidy.front) return n;
  if (FENCE.test(line.text)) {
    tidy.inFence = !tidy.inFence;
    tidy.blanks = 0;
    return n;
  }
  if (tidy.inFence) {
    tidy.blanks = 0;
    return n;
  }

  // Before the line rules, and taking the whole block rather than one line:
  // a column is as wide as the widest cell in it, which no single line knows.
  // `first === n` because the loop jumps to `last`, so it only ever meets a
  // table at its top. Saying so keeps a change from overlapping one already
  // pushed, which CodeMirror throws on.
  const table = tableAt(doc, n);
  if (table?.first === n) {
    const to = doc.line(table.last).to;
    const drawn = alignTable(doc, table);
    if (drawn !== doc.sliceString(line.from, to)) {
      tidy.changes.push({ from: line.from, to, insert: drawn });
    }
    tidy.blanks = 0;
    return table.last;
  }

  tidyText(line, tidy);
  return n;
}

function tidyText(line: Line, tidy: Tidy): void {
  const text = line.text.replace(/\s+$/, "").replace(BULLET, "$1-$2");

  if (text === "") {
    tidy.blanks++;
    // The second blank in a row goes, and it takes the newline in front of it
    // rather than the one behind, so two dropped in a row cannot overlap. The
    // first line of a note is never the second blank, so `from - 1` is safe.
    if (tidy.blanks > 1) tidy.changes.push({ from: line.from - 1, to: line.to });
    else if (text !== line.text) tidy.changes.push({ from: line.from, to: line.to });
    return;
  }

  const gap = HEADING.test(text) && tidy.blanks === 0 && tidy.seen > 1 ? "\n" : "";
  if (gap || text !== line.text) {
    tidy.changes.push({ from: line.from, to: line.to, insert: gap + text });
  }
  tidy.blanks = 0;
}

/** A lettered mark, `a)` or `b.`, which CommonMark reads as text. */
export const LETTER_MARK = /[a-z][.)]/;
/** A list item's line: its indent, its mark, and the spaces after the mark. */
const ITEM = new RegExp(`^(\\s*)([-*+]|\\d{1,9}[.)]|${LETTER_MARK.source})( +|$)`);
/** A thematic break: three or more of one of `-`, `*` or `_`, spaces allowed between. */
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TODO_BOX = /^\[.\]( |$)/;

type ListStyle = "bullet" | "number" | "letter";

/** The order `cycleListStyle` steps through. */
const NEXT_STYLE: Record<ListStyle, ListStyle> = {
  bullet: "number",
  number: "letter",
  letter: "bullet",
};

/** One item of the list being restyled, with the deeper lines that belong to it. */
interface ListItem {
  line: Line;
  indent: number;
  mark: string;
  gap: string;
  children: Line[];
}

/** How far a line's text starts in, a tab counting as four. */
function indentWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === " ") width++;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

function styleOf(mark: string): ListStyle {
  if (/^[-*+]$/.test(mark)) return "bullet";
  return /^\d/.test(mark) ? "number" : "letter";
}

/** Where a numbered or lettered list starts counting, 1 for `a)`. */
function startOf(mark: string): number {
  const style = styleOf(mark);
  if (style === "number") return Number.parseInt(mark, 10);
  return style === "letter" ? mark.charCodeAt(0) - 96 : 1;
}

function markFor(style: ListStyle, count: number): string {
  if (style === "bullet") return "-";
  return style === "number" ? `${count}.` : `${String.fromCharCode(96 + count)})`;
}

/** The line where the item holding line `n` starts, or null outside a list. */
function itemLineAt(doc: Text, n: number): number | null {
  for (let at = n; at >= 1; at--) {
    const text = doc.line(at).text;
    if (ITEM.test(text)) return at;
    // A heading, fence or rule is no item's continuation, so the list above it is another block.
    if (text.trim() === "" || HEADING.test(text) || FENCE.test(text) || RULE.test(text))
      return null;
  }
  return null;
}

/** The next non-blank line from `n` on, going by `step`, or null at the note's edge. */
function nextFilled(doc: Text, n: number, step: number): Line | null {
  for (let at = n; at >= 1 && at <= doc.lines; at += step) {
    const line = doc.line(at);
    if (line.text.trim() !== "") return line;
  }
  return null;
}

/** Where a list's items start and the kind of mark they share. */
interface Level {
  indent: number;
  kind: string;
}

/** What CommonMark ends a list on a change of: the bullet's character, or the style and its `.` or `)`. */
function kindOf(mark: string): string {
  return styleOf(mark) === "bullet" ? mark : `${styleOf(mark)}${mark.at(-1)}`;
}

/** Whether `line` belongs to the list at `level`, as a sibling or deeper. */
function inList(line: Line | null, level: Level): boolean {
  if (line === null) return false;
  const width = indentWidth(line.text);
  if (width !== level.indent) return width > level.indent;
  const item = ITEM.exec(line.text);
  return item !== null && kindOf(item[2] ?? "") === level.kind;
}

/** Whether the line at `at` carries the list on, a blank one by the next filled line past it. */
function continues(doc: Text, at: number, step: number, level: Level): boolean {
  const line = doc.line(at);
  return line.text.trim() === "" ? inList(nextFilled(doc, at, step), level) : inList(line, level);
}

/** The first item at the anchor's level, walking up past blank and deeper lines. */
function firstItem(doc: Text, anchor: number, level: Level): number {
  let first = anchor;
  for (let at = anchor - 1; at >= 1 && continues(doc, at, -1, level); at--) {
    if (indentWidth(doc.line(at).text) === level.indent) first = at;
  }
  return first;
}

/** The items of the list at line `n`, at its own level, each with the deeper lines under it. */
function listAt(doc: Text, n: number): ListItem[] | null {
  const anchor = itemLineAt(doc, n);
  if (anchor === null) return null;
  const text = doc.line(anchor).text;
  const indent = indentWidth(text);
  const level = { indent, kind: kindOf(ITEM.exec(text)?.[2] ?? "-") };

  const items: ListItem[] = [];
  for (let at = firstItem(doc, anchor, level); at <= doc.lines; at++) {
    if (!continues(doc, at, 1, level)) break;
    const line = doc.line(at);
    if (line.text.trim() === "") continue;
    const item = indentWidth(line.text) === indent ? ITEM.exec(line.text) : null;
    if (item) {
      items.push({
        line,
        indent: item[1]?.length ?? 0,
        mark: item[2] ?? "-",
        gap: item[3] ?? "",
        children: [],
      });
    } else {
      items.at(-1)?.children.push(line);
    }
  }
  return items;
}

function inCode(state: EditorState, at: number): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return true;
  }
  return false;
}

/**
 * Steps the list under the cursor from bullets to `1.` to `a)` and back, renumbering as it goes.
 * Only the cursor's level changes; deeper lines move right when a wider mark would unnest them.
 * A list of todos is left alone, since a todo is a `-` item. Returns whether it changed the note.
 */
export function cycleListStyle(view: EditorView): boolean {
  const { doc } = view.state;
  const items = listAt(doc, doc.lineAt(view.state.selection.main.head).number);
  if (items === null || items.length === 0) return false;
  // A YAML list in the frontmatter or a list in a fence is not markdown to restyle.
  const front = frontEnd(doc);
  if (items.some(({ line }) => line.number <= front || inCode(view.state, line.from))) return false;
  if (
    items.some((item) =>
      TODO_BOX.test(item.line.text.slice(item.indent + item.mark.length + item.gap.length)),
    )
  )
    return false;

  const [head] = items;
  const start = head === undefined || styleOf(head.mark) === "bullet" ? 1 : startOf(head.mark);
  let style = NEXT_STYLE[styleOf(head?.mark ?? "-")];
  // Past `z)` there is no letter. And `a)` is paragraph text to CommonMark, so
  // a child under it parses as a list of its own and draws at the wrong level.
  const nested = items.some((item) => item.children.some((child) => child.text.trim() !== ""));
  if (style === "letter" && (nested || start + items.length - 1 > 26)) style = "bullet";

  const changes: ChangeSpec[] = [];
  items.forEach((item, index) => {
    const mark = markFor(style, start + index);
    const from = item.line.from + item.indent;
    changes.push({ from, to: from + item.mark.length, insert: mark });
    // A child nests only while it starts at least as far in as the item's text.
    const wider = mark.length - item.mark.length;
    if (wider > 0) {
      for (const child of item.children)
        changes.push({ from: child.from, insert: " ".repeat(wider) });
    }
  });
  view.dispatch({ changes });
  return true;
}
