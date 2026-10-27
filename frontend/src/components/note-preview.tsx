import { EditorState, Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  lineNumbers,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import { kastenTheme } from "@/lib/editor-theme";
import { renderedMarkdown } from "@/lib/live/live-preview";
import { opensFor } from "@/lib/live/live-preview-callouts";
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
  /** Draws each cloze gap of the text as a pill, for the front of a cloze card. */
  gaps?: boolean;
}

/** Paints the line a search hit sits on, so the eye lands on it. */
const HIT = Decoration.line({ class: "cm-searchHit" });

/**
 * A cloze gap, `\[...\]` or `\[hint\]`, marked over its text rather than replaced.
 *
 * A mark and not a widget, so the brackets stay in the DOM where the text reads
 * them. The escapes are the ones `clozeQuestion` writes, which the preview would
 * otherwise read as a link.
 */
const GAP = Decoration.mark({ class: "review-gap", attributes: { "data-gap": "" } });
const gapFinder = new MatchDecorator({ regexp: /\\\[.*?\\\]/g, decoration: GAP });
const GAPS = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = gapFinder.createDeco(view);
    }

    update(update: ViewUpdate) {
      this.decorations = gapFinder.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

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
export function NotePreview({ text, firstLine, markLine, gaps }: NotePreviewProps) {
  const host = useRef<HTMLDivElement>(null);

  // Read once, on mount. Both panes pass a `key` that changes with the note
  // and the line, so showing another one remounts rather than reconfigures,
  // and there is no second path to keep in step with this one.
  const initial = useRef({ text, firstLine, markLine, gaps });

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const { text: source, firstLine: from, markLine: mark, gaps: marked } = initial.current;
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
          kastenTheme,
          EditorView.lineWrapping,
          // A static set rather than a state field: the document never
          // changes here, so neither can the mark on it.
          EditorView.decorations.of(hit ? Decoration.set([HIT.range(hit.from)]) : Decoration.none),
          // A hit in a folded callout's body would mark a line nobody can see.
          ...(hit ? [opensFor.of(hit.from)] : []),
          ...(marked ? [GAPS] : []),
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
