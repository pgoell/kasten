import type { Extension, Text } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** One heading of the note: its level, its words, where it starts and the line it is on. */
export interface OutlineHeading {
  level: number;
  text: string;
  from: number;
  /** One-based, as the editor counts lines. */
  line: number;
}

/** The note's headings, the one the reader is in (or -1), and a way to jump to any of them. */
export interface Outline {
  headings: OutlineHeading[];
  current: number;
  jump: (index: number) => void;
}

/** An ATX heading: one to six hashes, a space, the words, and any closing hashes. */
const ATX = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** A fence opener, which a fence closes only with the same character and at least as long. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** How far below the top of the scroller a heading still counts as the one being read. */
const READING_LINE = 24;

/**
 * The lines from `first` on that are not inside a fenced block, numbered as the
 * editor numbers them.
 *
 * A `#` line inside a fence is code, and a `[[` or `#tag` inside one is no
 * link or tag: every reader of the body skips the same lines.
 */
export function proseLines(doc: Text, first: number): { line: number; text: string }[] {
  const lines: { line: number; text: string }[] = [];
  let fence: string | null = null;
  for (let line = first; line <= doc.lines; line += 1) {
    const { text } = doc.line(line);
    const opened = FENCE.exec(text)?.[1];
    if (fence === null) {
      if (opened !== undefined) fence = opened;
      else lines.push({ line, text });
    } else if (opened !== undefined && opened[0] === fence[0] && opened.length >= fence.length) {
      fence = null;
    }
  }
  return lines;
}

/** The headings of the lines `proseLines` keeps. */
function headingsOf(doc: Text, first: number): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  for (const { line, text } of proseLines(doc, first)) {
    const found = ATX.exec(text);
    if (found?.[1] === undefined || found[2] === undefined) continue;
    headings.push({
      level: found[1].length,
      text: found[2],
      from: doc.line(line).from,
      line,
    });
  }
  return headings;
}

/**
 * The index of the last heading whose line starts at or above the reading line,
 * or -1 while the note is scrolled above its first heading.
 */
function currentOf(view: EditorView, headings: OutlineHeading[]): number {
  const reach = view.scrollDOM.scrollTop + READING_LINE;
  let current = -1;
  headings.forEach((heading, index) => {
    if (view.lineBlockAt(heading.from).top <= reach) current = index;
  });
  return current;
}

/**
 * The index of the last heading at or above the cursor, or -1 above the first.
 *
 * The cursor is what the reader is writing in, so the section it is in is the
 * one marked when the scroll has not moved it yet.
 */
function cursorCurrentOf(view: EditorView, headings: OutlineHeading[]): number {
  const head = view.state.selection.main.head;
  let current = -1;
  headings.forEach((heading, index) => {
    if (heading.from <= head) current = index;
  });
  return current;
}

/**
 * Reports the outline on every change of its headings or of the heading being
 * read. A class and not a closure so the scroll listener and the update share
 * the last report and the scroller's listener can be removed in `destroy`.
 */
class OutlineReporter {
  private readonly view: EditorView;
  private readonly report: (outline: Outline) => void;
  private readonly bodyLine: (doc: Text) => number;
  private readonly onScroll = () => {
    this.view.requestMeasure({
      read: (view) => currentOf(view, this.headings),
      write: (current) => this.publish(current),
    });
  };
  private headings: OutlineHeading[] = [];
  private reported = "";

  constructor(
    view: EditorView,
    report: (outline: Outline) => void,
    bodyLine: (doc: Text) => number,
  ) {
    this.view = view;
    this.report = report;
    this.bodyLine = bodyLine;
    this.refresh();
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
  }

  update(update: ViewUpdate) {
    if (update.docChanged) this.refresh();
    else if (update.selectionSet) this.publish(cursorCurrentOf(this.view, this.headings));
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
  }

  /** Reads the headings of the doc as it is now, then reports. */
  private refresh() {
    const { doc } = this.view.state;
    this.headings = headingsOf(doc, this.bodyLine(doc));
    this.publish(cursorCurrentOf(this.view, this.headings));
  }

  /** Reports when the headings or the heading being read differ from the last report. */
  private publish(current: number) {
    const key = JSON.stringify([this.headings, current]);
    if (key === this.reported) return;
    this.reported = key;
    this.report({ headings: this.headings, current, jump: (index) => this.jump(index) });
  }

  private jump(index: number) {
    const heading = this.headings[index];
    if (heading === undefined) return;
    this.view.dispatch({
      selection: { anchor: heading.from },
      effects: EditorView.scrollIntoView(heading.from, { y: "start", yMargin: READING_LINE }),
    });
    // The cursor update reports this already. Saying it here too keeps `current === index`
    // whatever the view does with the selection on the way.
    this.publish(index);
    this.view.focus();
  }
}

/**
 * Reports the outline of the note. `bodyLine` says which line the headings start
 * from, which is past the frontmatter: a `# ` in a YAML value is not a heading.
 */
export function outlinePlugin(
  report: (outline: Outline) => void,
  bodyLine: (doc: Text) => number,
): Extension {
  return ViewPlugin.define((view) => new OutlineReporter(view, report, bodyLine));
}
