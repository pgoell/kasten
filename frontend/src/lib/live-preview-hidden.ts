import {
  EditorSelection,
  type EditorState,
  type Line,
  type Range,
  type RangeSet,
  type Text,
} from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { editingMode, type VimMode } from "@/lib/vim-mode";

/** An empty replacement: the range is in the document but not on the screen. */
export const HIDDEN = Decoration.replace({});

/** A folded callout's body, told apart from `HIDDEN` by `skipHidden`. */
export const FOLDED = Decoration.replace({});

/**
 * Normal and replace mode read; insert and visual mode write.
 *
 * A mode we do not know renders, so a vim submode nobody thought about hides
 * its marks rather than leaking them.
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
 *
 * What the inline constructs go by, rather than the line rule above. A line of
 * prose can carry a dozen of them, and unmasking all twelve to edit one word
 * puts asterisks and tildes across the line you are reading while you write it.
 * The one the cursor is in is the one whose marks are worth seeing.
 */
export function isNodeRevealed(state: EditorState, from: number, to: number): boolean {
  if (!revealsSource(editingMode(state))) return false;
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/**
 * Whether a block the cursor is inside shows its source, in any mode.
 *
 * The cursor in it is what shows the source, in any mode, and not the mode alone
 * the way every other construct here works. `j` and `k` step over the whole
 * widget, CodeMirror moving by what is on the screen, so a rule waiting for
 * insert mode would leave the table nothing could open. What does reach in is
 * `w`, a search, a line jump and a click, all of which move by document position.
 *
 * A read-only view has no cursor to go in and a selection sitting at offset
 * zero, so a note that opens with a table would show its pipes.
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
   *
   * A cell's marks stay on the screen, because a table's columns are lined up
   * by counting characters and hiding two of them shortens the cell by two.
   * The walk is depth-first and in document order, so one number is enough:
   * everything inside the table is entered before anything after it.
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
   *
   * The space has to go with it. Hiding `#` alone would leave the heading
   * indented by one character against every other line in the note.
   */
  hideLeader(from: number, markTo: number, line: Line): void {
    let to = markTo;
    while (to < line.to && this.state.doc.sliceString(to, to + 1) === " ") to++;
    this.hide(from, to);
  }
}

/**
 * Walks a position off any character that is not on the screen.
 *
 * The shape is `skipAtomicRanges` from @codemirror/view, which does this for
 * `EditorView.atomicRanges`. Vim never consults that facet, so the same walk
 * has to happen here, with one rule tightened. CodeMirror lets the cursor rest
 * on either edge of an atomic range, because both edges paint in the same
 * place. That is fine for motion and wrong for editing: resting on `from` means
 * `x` deletes a character nobody can see. So a position counts as bad when
 * `from <= pos < to`, and only `to` is a landing spot.
 *
 * `direction` flips at most once, from backward to forward, when the hidden run
 * starts a line and there is nothing to its left to retreat to. Each direction
 * moves `pos` monotonically, so the walk cannot cycle.
 *
 * A folded callout's body runs the other way round. It starts at the end of
 * the title, which is where the cursor belongs, and every position after that
 * up to the body's end is bad: the end of its last line paints at the end of
 * the title too, and `dd` there deletes a line nobody can see. Forward lands
 * on the line under the box, backward and at the end of the note on the
 * title. A move up from far along the line under it lands at the body's end,
 * and the general rule would send it back down, the run starting a line.
 */
function skipHidden(start: number, bias: number, hidden: RangeSet<Decoration>, doc: Text): number {
  let pos = start;
  let direction = bias;

  for (;;) {
    let moved = false;
    hidden.between(pos - 1, pos + 1, (from, to, value) => {
      if (value === FOLDED) {
        if (pos <= from || pos > to) return;
        pos = direction < 0 || to === doc.length ? from : to + 1;
        moved = true;
        return;
      }
      if (pos < from || pos >= to) return;
      const lineStart = doc.lineAt(from).from;
      if (direction < 0 && from > lineStart) {
        pos = from - 1;
      } else {
        pos = to;
        direction = 1;
      }
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
