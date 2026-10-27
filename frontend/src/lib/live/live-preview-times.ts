import { type EditorState, Facet } from "@codemirror/state";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { linkAddress } from "@/lib/link-reference";
import { HIDDEN, type Walk } from "@/lib/live/live-preview-hidden";
import { noteVideos, videoId } from "@/lib/video";
import { parseTime } from "@/lib/video-notes";

/**
 * The seek a time asks for: its second, and the video a take's link names.
 *
 * The id is undefined for a bare `[mm:ss]`, which names no video. The route
 * owns the players, so the note only says which video and where in it.
 */
export type SeekHandler = (seconds: number, id?: string) => void;

/**
 * Carries the seek callback, for the reason `followHandler` carries the follow.
 */
export const timeSeek = Facet.define<SeekHandler, SeekHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * The videos the note links, read once for a rebuild rather than once per time.
 *
 * A note of a thousand stamps would otherwise read its whole text a thousand
 * times on each rebuild. Read the first time a stamp asks, so a note with no
 * stamps reads nothing.
 */
export function linkedVideos(state: EditorState): () => string[] {
  let videos: string[] | undefined;
  return () => {
    videos ??= noteVideos(state.doc.toString());
    return videos;
  };
}

/** `[mm:ss]` or `[h:mm:ss]`, the brackets `timestamp` in `transcript.ts` writes. */
const BRACKETED = /^\[(?:\d+:)?\d{2}:\d{2}\]$/;

/** The same time without brackets, which is what a take's link text holds. */
const BARE = /^(?:\d+:)?\d{2}:\d{2}$/;

/** The second a YouTube address starts at, as a take writes it: `&t=754s`. */
const START = /[?&]t=(\d+)s(?=&|$)/;

/**
 * A take at the first second writes no `t`, its link text being `00:00` or `0:00:00`.
 */
const ZERO = /^(?:0:)?00:00$/;

/** A time drawn as a button that seeks the note's video to it. */
class TimeButton extends WidgetType {
  private readonly label: string;
  private readonly seconds: number;
  private readonly id: string | undefined;

  constructor(label: string, seconds: number, id?: string) {
    super();
    this.label = label;
    this.seconds = seconds;
    this.id = id;
  }

  override eq(other: TimeButton): boolean {
    return other.label === this.label && other.seconds === this.seconds && other.id === this.id;
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-time";
    button.dataset.seconds = String(this.seconds);
    button.setAttribute("aria-label", `Seek to ${this.label}`);
    button.textContent = this.label;
    // The press is kept from the editor, or it would move the cursor onto the
    // line and show its source the button stands for.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => view.state.facet(timeSeek)?.(this.seconds, this.id));
    return button;
  }

  // The button handles its own presses, so the editor does not read them as
  // a click on the text under it.
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * The button a node stands for, or null when it is no time.
 *
 * Two shapes: a transcript's bare `[mm:ss]`, and a take's `[mm:ss](youtube&t=Ns)`.
 * Both need a video in the note, since a button with no player to drive does
 * nothing. A take's video must be one the note links, so a link to some other
 * video stays an ordinary link.
 */
function timeOf(state: EditorState, node: SyntaxNode, linked: () => string[]): TimeButton | null {
  const text = state.doc.sliceString(node.from, node.to);
  if (BRACKETED.test(text)) {
    // `[mm:ss](` and `[mm:ss]:` are not the bare time, whatever follows them.
    const next = state.doc.sliceString(node.to, node.to + 1);
    if (next === "(" || next === ":") return null;
    const seconds = parseTime(text);
    if (seconds === null || linked().length === 0) return null;
    return new TimeButton(text.slice(1, -1), seconds);
  }

  const [open, close] = node.getChildren("LinkMark");
  if (!open || !close) return null;
  const label = state.doc.sliceString(open.to, close.from);
  const address = linkAddress(node, state.doc);
  if (!BARE.test(label) || address === null) return null;
  const id = videoId(address);
  if (id === null || !linked().includes(id)) return null;
  const start = START.exec(address);
  const seconds = start !== null ? Number(start[1]) : ZERO.test(label) ? 0 : null;
  if (seconds === null) return null;
  return new TimeButton(label, seconds, id);
}

/**
 * Draws the time as a button over its source, off the cursor's line.
 *
 * Called ahead of the ordinary link, so a take's link is drawn as the button and
 * not as a link with a click that opens the address. Returns whether it drew.
 * Hidden the way a ruby is, so the cursor cannot rest inside the source the
 * button stands for.
 */
export function drawTime(
  walk: Walk,
  node: SyntaxNode,
  revealed: boolean,
  linked: () => string[],
): boolean {
  if (revealed) return false;
  const button = timeOf(walk.state, node, linked);
  if (button === null) return false;
  walk.decorations.push(Decoration.replace({ widget: button }).range(node.from, node.to));
  walk.hidden.push(HIDDEN.range(node.from, node.to));
  walk.drawn = node.to;
  return true;
}
