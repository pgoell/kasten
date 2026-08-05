import { syntaxTree } from "@codemirror/language";
import type { Extension, Line, Range, Text } from "@codemirror/state";
import { EditorSelection, EditorState, type RangeSet, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { setVimMode, type VimMode, vimModeField, vimModeState } from "@/lib/vim-mode";

/** An empty replacement: the range is in the document but not on the screen. */
const HIDDEN = Decoration.replace({});

const HEADING = /^ATXHeading([1-6])$/;

/** How far one level of list nesting shifts a rendered item, in `em`. */
const BULLET_INDENT = 1.6;

/**
 * How many lists a list item sits inside.
 *
 * The spaces that nest an item are hidden along with its `-`, so nothing in
 * the text carries the nesting any more and the indent has to be drawn from
 * the depth instead.
 */
function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "BulletList" || parent.name === "OrderedList") depth++;
  }
  return depth;
}

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
  Highlight: { mark: "HighlightMark", class: "cm-highlight" },
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
      const isFence = node.name === "FencedCode";
      const isRule = node.name === "HorizontalRule";
      if (!heading && !inline && !isLink && !isQuote && !isBullet && !isFence && !isRule) return;

      // Every line of the block, so the run reads as one surface with the code
      // in a monospaced face. Nothing is hidden: the language and the backticks
      // are part of what the block says, and the code inside is already
      // highlighted by whichever parser the language named.
      if (isFence) {
        const first = state.doc.lineAt(node.from).number;
        const last = state.doc.lineAt(node.to).number;
        for (let number = first; number <= last; number++) {
          const edge = number === first ? " cm-code-open" : number === last ? " cm-code-close" : "";
          const at = state.doc.line(number).from;
          decorations.push(Decoration.line({ class: `cm-code-block${edge}` }).range(at));
        }
        return;
      }

      const line = state.doc.lineAt(node.from);
      const revealed = isLineRevealed(state, line);

      // The line is drawn, so the dashes asking for it go. Like the bullet and
      // unlike the blockquote's bar, the drawing stands in for characters, so
      // it leaves when they come back. `---` under a paragraph is a setext
      // heading rather than a rule, and the parser has already told them apart.
      if (isRule) {
        if (revealed) return;
        decorations.push(Decoration.line({ class: "cm-rule" }).range(line.from));
        hide(line.from, line.to);
        return;
      }

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

      // The bar is drawn in CSS, and unlike the bullet below it stands in for
      // nothing, so it can stay while the `>` is back on screen.
      if (isQuote) {
        decorations.push(Decoration.line({ class: "cm-blockquote" }).range(line.from));
        if (revealed) return;
        hideLeader(node.from, node.to, line);
        return;
      }

      // The dot is drawn in CSS, so it has to go the moment the `-` it stands
      // in for comes back, or the line carries two bullets. An ordered list is
      // left alone throughout: its number is content, not decoration.
      if (isBullet) {
        if (revealed) return;
        decorations.push(
          Decoration.line({
            class: "cm-bullet",
            attributes: { style: `padding-left: ${BULLET_INDENT * listDepth(node.node)}em` },
          }).range(line.from),
        );
        // From the start of the line, not the mark: the spaces that nest the
        // item go too, their job now done by the padding above.
        hideLeader(line.from, node.to, line);
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
