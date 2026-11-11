import {
  type EditorState,
  type Extension,
  Facet,
  RangeSet,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type GutterMarker,
  gutterLineClass,
} from "@codemirror/view";
import { belowFrontmatter } from "@/lib/markdown/frontmatter-language";
import { noteName } from "@/lib/notes/links/note-path";
import { flatLeadLines, flatten } from "@/lib/notes/text/note-lead";
import { notePath } from "@/lib/todo/todo-commands";

/**
 * Whether live preview is on, which is what Read means. The preview compartment holds this beside the rendering.
 * So it reads true exactly when the rendering is, and a toggle of either toggles both.
 */
export const readMode = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
});

/** What Read hides: the frontmatter's closing line ends at `frontEnd`, and the decorations do the hiding. */
interface Hiding {
  frontEnd: number;
  decorations: DecorationSet;
  gutter: RangeSet<GutterMarker>;
}

/** The end of the frontmatter's closing line, or 0 where there is no block. */
export function frontEndOf(doc: Text): number {
  const after = belowFrontmatter(doc.toString());
  // `belowFrontmatter` answers the start of the line after the closing fence,
  // whose newline is the last character of the closing line.
  return after === 0 ? 0 : doc.lineAt(after - 1).to;
}

/**
 * Read hides the frontmatter except while the cursor is in it. That is a block decoration, which only a field may make.
 */
export function readHiding(): Extension {
  return StateField.define<Hiding>({
    create: (state) => hiding(state, frontEndOf(state.doc)),
    update(value, tr) {
      const changed = tr.docChanged || tr.state.facet(readMode) !== tr.startState.facet(readMode);
      if (!changed && !tr.selection) return value;
      return hiding(tr.state, tr.docChanged ? frontEndOf(tr.state.doc) : value.frontEnd);
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.decorations),
      gutterLineClass.from(field, (value) => value.gutter),
    ],
  });
}

/** What Read hides now: the frontmatter, and the lines `leadLines` names. */
function hiding(state: EditorState, frontEnd: number): Hiding {
  const path = state.facet(notePath);
  const fence = state.doc.lineAt(frontEnd);
  const below = frontEnd === 0 ? 1 : fence.number + 1;
  const lead =
    path === undefined || !state.facet(readMode) ? [] : flatLeadLines(state, below, noteName(path));
  const block = hidesBlock(state, frontEnd);
  // The closing fence stays a drawn line: vim's j and k skip lines with no height, and
  // would carry `dk` into the hidden block above it.
  const flat = flatten(state.doc, lead);
  const replaced = block
    ? [
        Decoration.replace({ block: true }).range(0, fence.from - 1),
        Decoration.replace({}).range(fence.from, fence.to),
      ]
    : [];
  return {
    frontEnd,
    decorations: Decoration.set([...replaced, ...flat.decorations], true),
    gutter: RangeSet.of(flat.gutter, true),
  };
}

/**
 * Whether Read hides the frontmatter in `state`: only while every selection starts below it.
 * A selection starting in the block shows the YAML, so a line selection from the top does too.
 */
function hidesBlock(state: EditorState, frontEnd: number): boolean {
  return (
    state.facet(notePath) !== undefined &&
    state.facet(readMode) &&
    frontEnd > 0 &&
    state.selection.ranges.every((range) => range.from > frontEnd)
  );
}
