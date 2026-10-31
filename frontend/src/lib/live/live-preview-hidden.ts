import {
  EditorSelection,
  type EditorState,
  type Line,
  type Range,
  type RangeSet,
  type Text,
} from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { editingMode, type VimMode } from "@/lib/editor/vim-mode";

/** An empty replacement: the range is in the document but not on the screen. */
export const HIDDEN = Decoration.replace({});

/** A folded callout's body, told apart from `HIDDEN` by `skipHidden`. */
export const FOLDED = Decoration.replace({});

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

  constructor(state: EditorState) {
    this.state = state;
  }

  hide(from: number, to: number): void {
    const range = HIDDEN.range(from, to);
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
