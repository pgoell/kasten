import type { EditorState, Range, Text } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker } from "@codemirror/view";

/**
 * The lines between the frontmatter and a note's text: blank lines, and a `# ` heading that only
 * repeats the title the header shows. Read gives them no height. `first` is the body's first line.
 */
export function leadLines(doc: Text, first: number, title: string): number[] {
  const lines: number[] = [];
  let titled = false;
  for (let n = first; n <= doc.lines; n++) {
    const text = doc.line(n).text.trim();
    const repeats: boolean = !titled && /^#\s/.test(text) && text.slice(1).trim() === title.trim();
    if (text !== "" && !repeats) break;
    titled ||= repeats;
    lines.push(n);
  }
  return lines;
}

/** Where a note opens with nothing saved: its text, past the lines Read gives no height. A note with no text opens on `first`. */
export function textStart(doc: Text, first: number, title: string): number {
  const after = first + leadLines(doc, first, title).length;
  return doc.line(after > doc.lines ? first : after).from;
}

class Flat extends GutterMarker {
  override elementClass = "cm-flat";
}

/** No height for the line, nor for its number and fold arrow beside it. */
const FLAT = Decoration.line({ class: "cm-flat" });
const FLAT_GUTTER = new Flat();

export const flatTheme = EditorView.theme({
  ".cm-line.cm-flat": {
    height: "0 !important",
    margin: "0 !important",
    padding: "0 !important",
    overflow: "hidden",
  },
  // CodeMirror sets the number's height to its line's, and its top margin places the gutter.
  ".cm-gutterElement.cm-flat": { overflow: "hidden" },
});

/** The lead lines Read flattens now: those no cursor is on, as a cursor shows its line. */
export function flatLeadLines(state: EditorState, first: number, title: string): number[] {
  return leadLines(state.doc, first, title).filter((n) => {
    const line = state.doc.line(n);
    return !state.selection.ranges.some((r) => r.from <= line.to && r.to >= line.from);
  });
}

/** The line decoration and gutter marker that flatten each of `lines`. */
export function flatten(
  doc: Text,
  lines: number[],
): {
  decorations: Range<Decoration>[];
  gutter: Range<GutterMarker>[];
} {
  const starts = lines.map((n) => doc.line(n).from);
  return {
    decorations: starts.map((at) => FLAT.range(at)),
    gutter: starts.map((at) => FLAT_GUTTER.range(at)),
  };
}
