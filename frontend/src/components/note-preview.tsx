import { EditorState, Text } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { Decoration, EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { renderedMarkdown } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";

interface NotePreviewProps {
  /** The text to show. Read on mount; pass a `key` to show another note. */
  text: string;
  /**
   * The note's own number for the first line of `text`, which turns the gutter
   * on. Absent shows no numbers, which is what the finder wants.
   */
  firstLine?: number;
  /** The note's own number of the line to mark and centre on. */
  markLine?: number;
}

/** Paints the line a search hit sits on, so the eye lands on it. */
const HIT = Decoration.line({ class: "cm-searchHit" });

/**
 * A note, rendered the way the editor renders it, with nothing to type into.
 *
 * The same decorations the editor mounts, so the pane shows the note as
 * opening it will show it rather than as a second, plainer document. That is
 * the whole reason this is CodeMirror and not a `<pre>`: the rendering already
 * exists, and any other one would drift from it.
 *
 * Uneditable rather than merely read-only, because an uneditable view takes no
 * focus. The dialog above owns the arrows and Enter, and a pane that could be
 * typed into would swallow them.
 */
export function NotePreview({ text, firstLine, markLine }: NotePreviewProps) {
  const host = useRef<HTMLDivElement>(null);

  // Read once, on mount. Both panes pass a `key` that changes with the note
  // and the line, so showing another one remounts rather than reconfigures,
  // and there is no second path to keep in step with this one.
  const initial = useRef({ text, firstLine, markLine });

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const { text: source, firstLine: from, markLine: mark } = initial.current;
    // The search pane's window starts partway down the note, so the gutter
    // counts from where the window starts rather than from one.
    const offset = from === undefined ? 0 : from - 1;

    // Built here rather than left to `EditorState` because the decoration
    // below needs a position, and a position needs the document first.
    const doc = Text.of(source.split("\n"));
    const at = mark === undefined ? undefined : mark - offset;
    const hit = at !== undefined && at >= 1 && at <= doc.lines ? doc.line(at) : undefined;

    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          EditorView.editable.of(false),
          // Read at state level, unlike `editable`, which is what lets the
          // rendering tell a pane with no cursor from the editor: a table
          // opens its source for a cursor inside it, and offset zero here is
          // where the selection sits rather than where anybody put it.
          EditorState.readOnly.of(true),
          // The editor's own parse, wikilinks and frontmatter included: the
          // pane shows the note as opening it will, and no vault listing
          // reaches here, so every link renders as one that lands.
          noteLanguage(),
          renderedMarkdown(),
          oneDark,
          EditorView.lineWrapping,
          // A static set rather than a state field: the document never
          // changes here, so neither can the mark on it.
          EditorView.decorations.of(hit ? Decoration.set([HIT.range(hit.from)]) : Decoration.none),
          ...(from === undefined ? [] : [lineNumbers({ formatNumber: (n) => `${n + offset}` })]),
        ],
      }),
      parent,
    });

    if (hit) {
      view.dispatch({ effects: EditorView.scrollIntoView(hit.from, { y: "center" }) });
    }

    return () => view.destroy();
  }, []);

  return <div ref={host} className="h-full overflow-auto" />;
}
