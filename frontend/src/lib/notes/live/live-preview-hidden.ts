import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  type Line,
  type Range,
  type RangeSet,
  type Text,
  type Transaction,
} from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { editingMode, type VimMode } from "@/lib/notes/editor/vim-mode";
import { noteVideos } from "@/lib/panes/video/video";

/** An empty replacement: the range is in the document but not on the screen. */
export const HIDDEN = Decoration.replace({});

/** A marker of a construct's reach, never drawn. */
const WIDE = Decoration.mark({});

/** A folded callout's body, told apart from `HIDDEN` by `skipHidden`. */
export const FOLDED = Decoration.replace({});

/** Text a link drawn short hides: a cursor stays on it, and the link then shows its source (#1973). */
export const NAME = Decoration.replace({});

/**
 * Normal and replace mode read; insert and visual mode write.
 * An unknown mode renders, so a vim submode nobody thought of hides its marks.
 */
function revealsSource(mode: VimMode): boolean {
  return mode === "insert" || mode === "visual";
}

export function isLineRevealed(state: EditorState, line: Line): boolean {
  if (!revealsSource(editingMode(state))) return false;
  return state.selection.ranges.some((range) => range.from <= line.to && range.to >= line.from);
}

/**
 * Whether a construct the cursor is inside shows its source.
 * Only the construct the cursor is in unmasks; unmasking a whole line of marks is noisy.
 */
export function isNodeRevealed(state: EditorState, from: number, to: number): boolean {
  if (!revealsSource(editingMode(state))) return false;
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** Whether a cursor rests on `[from, to)`, which a read-only preview never has. */
export function isCursorOn(state: EditorState, from: number, to: number): boolean {
  return (
    !state.readOnly &&
    state.selection.ranges.some((range) => range.empty && range.head >= from && range.head < to)
  );
}

/**
 * Whether a block the cursor is inside shows its source, in any mode.
 * Not mode alone: `j` and `k` step over a whole widget, so insert mode would leave a table nothing could open.
 */
export function isBlockRevealed(state: EditorState, from: number, to: number): boolean {
  return (
    !state.readOnly && state.selection.ranges.some((range) => range.from <= to && range.to >= from)
  );
}

/**
 * What one walk over the document draws and hides, and where the table or the
 * widget it last drew reaches.
 */
export class Walk {
  readonly state: EditorState;
  readonly decorations: Range<Decoration>[] = [];
  readonly hidden: Range<Decoration>[] = [];
  /**
   * How far the table being walked reaches, or -1 outside one.
   * Cells keep their marks: columns line up by counting characters.
   */
  tableEnd = -1;
  /** How far a table or ruby widget already reaches, the walk going on past it. */
  drawn = -1;
  /** What a construct showing its source reaches past its block, as an svg over blank lines does, for a patch to redraw whole. */
  readonly wide: Range<Decoration>[] = [];

  constructor(state: EditorState) {
    this.state = state;
  }

  /** Notes that `[from, to]` is one construct across blocks, though nothing is drawn over it. */
  reaches(from: number, to: number): void {
    this.wide.push(WIDE.range(from, to));
  }

  hide(from: number, to: number, kind = HIDDEN): void {
    const range = kind.range(from, to);
    this.decorations.push(range);
    this.hidden.push(range);
  }

  /**
   * Hides a line-leading mark and the space that separates it from the text.
   * The space must go too, or the heading sits one character in from the others.
   */
  hideLeader(from: number, markTo: number, line: Line): void {
    let to = markTo;
    while (to < line.to && this.state.doc.sliceString(to, to + 1) === " ") to++;
    this.hide(from, to);
  }
}

/** A stretch of the note, both ends inside it. */
export type Span = readonly [number, number];

/** The nodes that hold the note's blocks: the frontmatter wrapper's and markdown's. */
const HOLDERS = new Set(["Document", "Body"]);

/**
 * Blocks an svg starts or runs on in, which it draws as one across blank lines, so no tree node gives its extent; and
 * the frontmatter, which a video's start reads. A span that reaches one is left to a whole walk.
 */
const WHOLE = new Set(["Frontmatter", "HTMLBlock", "CommentBlock", "ProcessingInstructionBlock"]);

/** How often an edit's stretch may grow before a whole walk is cheaper to trust. */
const ROUNDS = 8;

/** The blocks of `tree` that `[from, to]` reaches, as one span; null where one is in `WHOLE`. */
function blocksOf(tree: Tree, from: number, to: number): Span | null {
  let low = from;
  let high = to;
  let front = false;
  tree.iterate({
    from,
    to,
    enter(node) {
      if (HOLDERS.has(node.name)) return;
      if (WHOLE.has(node.name)) front = true;
      low = Math.min(low, node.from);
      high = Math.max(high, node.to);
      return false;
    },
  });
  return front ? null : [low, high];
}

/** Sorted, with spans that touch or overlap joined, each widened to whole lines. */
function joined(spans: Span[], doc: Text): Span[] {
  const lines = spans
    .map(([from, to]): Span => [doc.lineAt(from).from, doc.lineAt(to).to])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [from, to] of lines) {
    const last = out.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** Where an edit and the cursors before and after it sit in `tr.state`. */
function seedsOf(tr: Transaction): Span[] {
  const { changes, startState, state } = tr;
  const seeds: Span[] = [];
  changes.iterChangedRanges((_fromA, _toA, from, to) => seeds.push([from, to]));
  for (const r of startState.selection.ranges) {
    seeds.push([changes.mapPos(r.from, -1), changes.mapPos(r.to, 1)]);
  }
  for (const r of state.selection.ranges) seeds.push([r.from, r.to]);
  return seeds;
}

/** One span grown by the blocks it reaches in the new tree and the old, and by `widen`; null where a tree stops short. */
function grow(tr: Transaction, [from, to]: Span, widen: (span: Span) => Span): Span | null {
  const { changes, startState, state } = tr;
  const back = changes.invertedDesc;
  const [oldFrom, oldTo] = [back.mapPos(from, -1), back.mapPos(to, 1)];
  const parsed =
    syntaxTreeAvailable(state, Math.min(to + 1, state.doc.length)) &&
    syntaxTreeAvailable(startState, Math.min(oldTo + 1, startState.doc.length));
  const now = parsed ? blocksOf(syntaxTree(state), from, to) : null;
  const before = parsed ? blocksOf(syntaxTree(startState), oldFrom, oldTo) : null;
  if (now === null || before === null) return null;
  const [wideFrom, wideTo] = widen([from, to]);
  return [
    Math.min(now[0], changes.mapPos(before[0], -1), wideFrom),
    Math.max(now[1], changes.mapPos(before[1], 1), wideTo),
  ];
}

/** Whether `tree` holds a link definition in `[from, to]`, which a link anywhere in the note reads, in a quote or a list too. */
function defines(tree: Tree, from: number, to: number): boolean {
  let found = false;
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name === "LinkReference") found = true;
      return !found;
    },
  });
  return found;
}

/** Whether a line of `doc` in `[from, to]` links a video, which a time anywhere in the note seeks. */
function linksVideo(doc: Text, from: number, to: number): boolean {
  for (const line of doc.iterLines(doc.lineAt(from).number, doc.lineAt(to).number + 1)) {
    if (noteVideos(line).length > 0) return true;
  }
  return false;
}

/** Whether the spans held or hold text the rest of the note reads: a link definition or a video a time seeks. */
function readsAcross(tr: Transaction, spans: readonly Span[]): boolean {
  const back = tr.changes.invertedDesc;
  return spans.some(([from, to]) => {
    const [oldFrom, oldTo] = [back.mapPos(from, -1), back.mapPos(to, 1)];
    return (
      defines(syntaxTree(tr.state), from, to) ||
      defines(syntaxTree(tr.startState), oldFrom, oldTo) ||
      linksVideo(tr.state.doc, from, to) ||
      linksVideo(tr.startState.doc, oldFrom, oldTo)
    );
  });
}

/**
 * The stretches of `tr.state` a walk must redraw: the blocks the edit and the cursors touch, before and after, and
 * whatever an old drawing there reaches (`widen`); null where the tree stops short of them, they keep growing, or they
 * hold text the rest of the note reads.
 */
export function touchedSpans(tr: Transaction, widen: (span: Span) => Span): Span[] | null {
  let spans = joined(seedsOf(tr), tr.state.doc);
  for (let round = 0; round < ROUNDS; round++) {
    const next = spans.map((span) => grow(tr, span, widen));
    if (next.some((span) => span === null)) return null;
    const grown = joined(next as Span[], tr.state.doc);
    const same =
      grown.length === spans.length &&
      grown.every(([f, t], i) => spans[i]?.[0] === f && spans[i]?.[1] === t);
    if (same) return readsAcross(tr, spans) ? null : spans;
    spans = grown;
  }
  return null;
}

/**
 * Walks a position off hidden text, as `skipAtomicRanges` does (vim ignores atomicRanges), flipping direction at most once.
 * Lands on `to`, as `from` lets `x` delete a hidden character; a folded callout lands on `from` or the line under it.
 */
/** Where the cursor goes out of a folded body it is in, or null when it is not in it. */
function outOfFold(
  pos: number,
  from: number,
  to: number,
  direction: number,
  doc: Text,
): number | null {
  if (pos <= from || pos > to) return null;
  return direction < 0 || to === doc.length ? from : to + 1;
}

/** Where the cursor goes out of a hidden mark it is in, or null when it is not in it. */
function outOfMark(
  pos: number,
  from: number,
  to: number,
  direction: number,
  doc: Text,
): number | null {
  if (pos < from || pos >= to) return null;
  const lineStart = doc.lineAt(from).from;
  return direction < 0 && from > lineStart ? from - 1 : to;
}

function skipHidden(start: number, bias: number, hidden: RangeSet<Decoration>, doc: Text): number {
  let pos = start;
  let direction = bias;

  for (;;) {
    let moved = false;
    hidden.between(pos - 1, pos + 1, (from, to, value) => {
      if (value === NAME) return;
      const next =
        value === FOLDED
          ? outOfFold(pos, from, to, direction, doc)
          : outOfMark(pos, from, to, direction, doc);
      if (next === null) return;
      // Out past a mark's end the cursor goes on forward.
      if (value !== FOLDED && next === to) direction = 1;
      pos = next;
      moved = true;
    });
    if (!moved) return pos;
  }
}

export function nudgeOutOfHidden(
  next: EditorSelection,
  previous: EditorSelection,
  hidden: RangeSet<Decoration>,
  doc: Text,
): EditorSelection | null {
  let changed = false;

  const ranges = next.ranges.map((range, index) => {
    // A cursor only. Vim reads a yank by selecting what it covers, `yy` from
    // column zero, and walking that selection's ends out of the marks yanked
    // `## Notes` as `Notes`. A selection in visual mode reveals its marks, so
    // its ends have nothing hidden to land in.
    if (!range.empty) return range;
    const before = previous.ranges[Math.min(index, previous.ranges.length - 1)];
    const bias = before && range.head < before.head ? -1 : 1;
    const head = skipHidden(range.head, bias, hidden, doc);
    if (head === range.head) return range;
    changed = true;
    return EditorSelection.cursor(head);
  });

  return changed ? EditorSelection.create(ranges, next.mainIndex) : null;
}
