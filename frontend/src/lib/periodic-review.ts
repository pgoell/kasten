/**
 * The year review on a yearly note and the week review on a weekly one, drawn as a block
 * inside the note under its title. Nothing is written into the file: the block is a
 * decoration, and the text the editor holds is the text on disk.
 *
 * A block widget and not a React column above the editor, so the review scrolls with the
 * note and sits where the reader's own text starts. The React tree is mounted in the
 * widget's element, which is why the query client and the opener come in through a facet.
 */

import { type EditorState, type Extension, Facet, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { QueryClient } from "@tanstack/react-query";
import type { Root } from "react-dom/client";
import { mountReview } from "@/components/review-block";
import { weeklyWeek, yearlyYear } from "@/lib/periodic";
import { notePath } from "@/lib/todo-commands";
import { cardLine } from "@/lib/weather-card";

/** What the review reads with and opens notes with, handed in where the editor is built. */
export interface ReviewSource {
  /** The app's query cache, so the review reads under the keys the other panes share. */
  client: QueryClient;
  /** Opens a note in the focused pane at a 1-based line, as the embeds do. */
  open(path: string, line: number): void;
}

/**
 * Null without a source, and a view with no source draws no block. The editor is also
 * built bare in tests, where nothing is there to read the vault with.
 */
export const reviewSource = Facet.define<ReviewSource, ReviewSource | null>({
  combine: (values) => values[0] ?? null,
});

/**
 * The block's place: at the end of the title's line or of the link row under it, the way
 * the weather card sits. A note with no title gets it at the start of its body, after the
 * frontmatter, so it still shows.
 */
function anchorOf(doc: Text): { pos: number; side: -1 | 1 } {
  const title = cardLine(doc);
  if (title !== null) return { pos: doc.line(title).to, side: 1 };
  if (doc.line(1).text === "---") {
    for (let at = 2; at <= doc.lines; at++) {
      if (doc.line(at).text === "---") return { pos: doc.line(at).to, side: 1 };
    }
  }
  return { pos: 0, side: -1 };
}

// The observer and the root of each element, kept here because a widget's `destroy` is
// handed only the element it drew.
const observers = new WeakMap<HTMLElement, ResizeObserver>();
const roots = new WeakMap<HTMLElement, Root>();

class ReviewCard extends WidgetType {
  private readonly path: string;
  private readonly source: ReviewSource;

  constructor(path: string, source: ReviewSource) {
    super();
    this.path = path;
    this.source = source;
  }

  // The path names the review: a yearly note's year and a weekly note's week are read off
  // it, so two widgets for one path draw the same block and keep the same DOM.
  override eq(other: ReviewCard): boolean {
    return other.path === this.path;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.className = "cm-review";
    host.setAttribute("contenteditable", "false");
    roots.set(host, mountReview(host, this.path, this.source));
    // The block's height arrives with its data, after CodeMirror has measured it empty.
    // Asking for a measure when the element changes size is what keeps the lines below
    // where the block really is.
    const observer = new ResizeObserver(() => view.requestMeasure());
    observer.observe(host);
    observers.set(host, observer);
    return host;
  }

  // Clicks and taps inside the block are the block's: its buttons and its charts take them,
  // and the editor does not move its cursor for them.
  override ignoreEvent(): boolean {
    return true;
  }

  override destroy(dom: HTMLElement): void {
    observers.get(dom)?.disconnect();
    const root = roots.get(dom);
    // A root unmounted inside React's own commit warns, so the unmount waits for it.
    if (root !== undefined) queueMicrotask(() => root.unmount());
  }
}

function build(state: EditorState): DecorationSet {
  const source = state.facet(reviewSource);
  const path = state.facet(notePath);
  if (source === null || path === undefined) return Decoration.none;
  if (yearlyYear(path) === null && weeklyWeek(path) === null) return Decoration.none;
  const { pos, side } = anchorOf(state.doc);
  return Decoration.set([
    Decoration.widget({ widget: new ReviewCard(path, source), block: true, side }).range(pos),
  ]);
}

/**
 * The block as an editor extension. A field and not a view plugin, because a block widget
 * changes the height of the document, which CodeMirror takes only from state. Registered
 * outside the preview compartment, so the block shows in Edit as well as in Read.
 */
export const periodicReview: Extension = StateField.define<DecorationSet>({
  create: build,
  // A rename that leaves the text as it is changes the path the note is for, and so which review
  // (if any) it gets: the block is built again for that.
  update: (value, tr) =>
    tr.docChanged || tr.startState.facet(notePath) !== tr.state.facet(notePath)
      ? build(tr.state)
      : value,
  provide: (field) => EditorView.decorations.from(field),
});
