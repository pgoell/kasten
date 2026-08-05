import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Line, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { setVimMode, type VimMode, vimModeField, vimModeState } from "@/lib/vim-mode";

/** An empty replacement: the range is in the document but not on the screen. */
const HIDDEN = Decoration.replace({});

const HEADING = /^ATXHeading([1-6])$/;

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

function buildDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      const heading = HEADING.exec(node.name);
      if (!heading) return;

      const line = state.doc.lineAt(node.from);
      // The size stays put while the marks come and go, so revealing a line
      // does not make it jump.
      ranges.push(Decoration.line({ class: `cm-heading-${heading[1]}` }).range(line.from));
      if (isLineRevealed(state, line)) return;

      const mark = node.node.firstChild;
      if (mark?.name !== "HeaderMark") return;

      // The space after the hashes goes too. Hiding the mark alone would leave
      // the heading indented by one character against every other line.
      let to = mark.to;
      while (to < line.to && state.doc.sliceString(to, to + 1) === " ") to++;
      ranges.push(HIDDEN.range(mark.from, to));
    },
  });

  return Decoration.set(ranges, true);
}

const liveDecorations = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(value, tr) {
    const modeChanged = tr.effects.some((effect) => effect.is(setVimMode));
    if (!tr.docChanged && !tr.selection && !modeChanged) return value.map(tr.changes);
    return buildDecorations(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function livePreview(): Extension {
  return [vimModeState(), liveDecorations];
}
