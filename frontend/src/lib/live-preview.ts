import { syntaxTree } from "@codemirror/language";
import type { Extension, Line, Range, Text } from "@codemirror/state";
import { EditorSelection, EditorState, type RangeSet, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { setVimMode, type VimMode, vimModeField, vimModeState } from "@/lib/vim-mode";

/** An empty replacement: the range is in the document but not on the screen. */
const HIDDEN = Decoration.replace({});

const HEADING = /^ATXHeading([1-6])$/;

/**
 * Inline constructs, by the node that wraps them.
 *
 * Keyed by the wrapper rather than the delimiter because the delimiter does not
 * identify the construct: `EmphasisMark` is both `**` and `*`, and only the
 * parent says which.
 */
const INLINE: Record<string, { mark: string; class: string }> = {
  StrongEmphasis: { mark: "EmphasisMark", class: "cm-strong" },
  Emphasis: { mark: "EmphasisMark", class: "cm-emphasis" },
  InlineCode: { mark: "CodeMark", class: "cm-inline-code" },
  Strikethrough: { mark: "StrikethroughMark", class: "cm-strikethrough" },
};

/**
 * What the editor is showing, and which parts of the document it is not.
 *
 * The two travel together because the selection filter has to know where the
 * hidden ranges are, and a filter can only read state.
 */
interface Live {
  decorations: DecorationSet;
  hidden: RangeSet<Decoration>;
}

/**
 * Normal and replace mode read; insert and visual mode write.
 *
 * A mode we do not know renders, so a vim submode nobody thought about hides
 * its marks rather than leaking them.
 */
function revealsSource(mode: VimMode): boolean {
  return mode === "insert" || mode === "visual";
}

function isLineRevealed(state: EditorState, line: Line): boolean {
  if (!revealsSource(state.field(vimModeField))) return false;
  return state.selection.ranges.some((range) => range.from <= line.to && range.to >= line.from);
}

function build(state: EditorState): Live {
  const decorations: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];

  const hide = (from: number, to: number) => {
    const range = HIDDEN.range(from, to);
    decorations.push(range);
    hidden.push(range);
  };

  /**
   * Hides a line-leading mark and the space that separates it from the text.
   *
   * The space has to go with it. Hiding `#` alone would leave the heading
   * indented by one character against every other line in the note.
   */
  const hideLeader = (from: number, markTo: number, line: Line) => {
    let to = markTo;
    while (to < line.to && state.doc.sliceString(to, to + 1) === " ") to++;
    hide(from, to);
  };

  syntaxTree(state).iterate({
    enter(node) {
      const heading = HEADING.exec(node.name);
      const inline = INLINE[node.name];
      const isLink = node.name === "Link";
      const isQuote = node.name === "QuoteMark";
      const isBullet = node.name === "ListMark" && node.node.parent?.parent?.name === "BulletList";
      if (!heading && !inline && !isLink && !isQuote && !isBullet) return;

      const line = state.doc.lineAt(node.from);
      const revealed = isLineRevealed(state, line);

      if (heading) {
        // The size stays put while the marks come and go, so revealing a line
        // does not make it jump.
        decorations.push(Decoration.line({ class: `cm-heading-${heading[1]}` }).range(line.from));
        if (revealed) return;

        const mark = node.node.firstChild;
        if (mark?.name !== "HeaderMark") return;
        hideLeader(mark.from, mark.to, line);
        return;
      }

      // Both draw their marker in CSS, so the text keeps its indent without a
      // widget standing in for characters that are no longer there. An ordered
      // list is left alone: its number is content, not decoration.
      if (isQuote || isBullet) {
        const style = isQuote ? "cm-blockquote" : "cm-bullet";
        decorations.push(Decoration.line({ class: style }).range(line.from));
        if (revealed) return;
        hideLeader(node.from, node.to, line);
        return;
      }

      if (isLink) {
        // A link carries four marks, `[`, `]`, `(` and `)`. The first two
        // bracket the text worth showing; everything from the second to the end
        // of the node is `](url)` and goes.
        const marks: { from: number; to: number }[] = [];
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (child.name === "LinkMark") marks.push({ from: child.from, to: child.to });
        }
        const [open, close] = marks;
        if (!open || !close) return;

        if (open.to < close.from) {
          decorations.push(Decoration.mark({ class: "cm-link" }).range(open.to, close.from));
        }
        if (revealed) return;
        hide(open.from, open.to);
        hide(close.from, node.to);
        return;
      }

      if (!inline) return;

      let open: { from: number; to: number } | null = null;
      let close: { from: number; to: number } | null = null;
      for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name !== inline.mark) continue;
        open ??= { from: child.from, to: child.to };
        close = { from: child.from, to: child.to };
      }
      // An unclosed delimiter parses as a single mark. Nothing to render.
      if (!open || !close || open.from === close.from) return;

      if (open.to < close.from) {
        decorations.push(Decoration.mark({ class: inline.class }).range(open.to, close.from));
      }
      if (revealed) return;
      hide(open.from, open.to);
      hide(close.from, close.to);
    },
  });

  return {
    decorations: Decoration.set(decorations, true),
    hidden: Decoration.set(hidden, true),
  };
}

const live = StateField.define<Live>({
  create: build,
  update(value, tr) {
    const modeChanged = tr.effects.some((effect) => effect.is(setVimMode));
    if (!tr.docChanged && !tr.selection && !modeChanged) return value;
    return build(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

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
 */
function skipHidden(start: number, bias: number, hidden: RangeSet<Decoration>, doc: Text): number {
  let pos = start;
  let direction = bias;

  for (;;) {
    let moved = false;
    hidden.between(pos - 1, pos + 1, (from, to) => {
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

function nudgeOutOfHidden(
  next: EditorSelection,
  previous: EditorSelection,
  hidden: RangeSet<Decoration>,
  doc: Text,
): EditorSelection | null {
  let changed = false;

  const ranges = next.ranges.map((range, index) => {
    const before = previous.ranges[Math.min(index, previous.ranges.length - 1)];
    const bias = before && range.head < before.head ? -1 : 1;
    const head = skipHidden(range.head, bias, hidden, doc);
    const anchor = range.empty ? head : skipHidden(range.anchor, bias, hidden, doc);
    if (head === range.head && anchor === range.anchor) return range;
    changed = true;
    return EditorSelection.range(anchor, head);
  });

  return changed ? EditorSelection.create(ranges, next.mainIndex) : null;
}

/**
 * Keeps the cursor out of the hidden marks.
 *
 * Reads the ranges from the state before the transaction, mapped through its
 * changes. Reading `tr.state` instead would compute the new state from inside
 * the filter that helps produce it.
 */
const nudgeSelection = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr;

  const hidden = tr.startState.field(live).hidden.map(tr.changes);
  const nudged = nudgeOutOfHidden(tr.selection, tr.startState.selection, hidden, tr.newDoc);
  return nudged ? [tr, { selection: nudged }] : tr;
});

export function livePreview(): Extension {
  return [vimModeState(), live, nudgeSelection];
}
