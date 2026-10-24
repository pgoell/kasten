import { type EditorState, Facet } from "@codemirror/state";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { linkAddress } from "@/lib/link-reference";
import { HIDDEN, type Walk } from "@/lib/live-preview-hidden";
import { noteVideos, videoId } from "@/lib/video";
import { parseTime } from "@/lib/video-notes";

/**
 * Carries the seek callback, for the reason `followHandler` carries the follow.
 *
 * The note only names the seconds. The route owns the players, and it is the one
 * that knows which pane is playing this note's video.
 */
export const timeSeek = Facet.define<
  (seconds: number) => void,
  ((seconds: number) => void) | undefined
>({
  combine: (handlers) => handlers[0],
});

/** `[mm:ss]` or `[h:mm:ss]`, the brackets `timestamp` in `transcript.ts` writes. */
const BRACKETED = /^\[(?:\d+:)?\d{2}:\d{2}\]$/;

/** The same time without brackets, which is what a take's link text holds. */
const BARE = /^(?:\d+:)?\d{2}:\d{2}$/;

/** The second a YouTube address starts at, as a take writes it: `&t=754s`. */
const START = /[?&]t=(\d+)s(?=&|$)/;

/** A time drawn as a button that seeks the note's video to it. */
class TimeButton extends WidgetType {
  private readonly label: string;
  private readonly seconds: number;

  constructor(label: string, seconds: number) {
    super();
    this.label = label;
    this.seconds = seconds;
  }

  override eq(other: TimeButton): boolean {
    return other.label === this.label && other.seconds === this.seconds;
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
    button.addEventListener("click", () => view.state.facet(timeSeek)?.(this.seconds));
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
function timeOf(state: EditorState, node: SyntaxNode): TimeButton | null {
  const text = state.doc.sliceString(node.from, node.to);
  if (BRACKETED.test(text)) {
    // `[mm:ss](` and `[mm:ss]:` are not the bare time, whatever follows them.
    const next = state.doc.sliceString(node.to, node.to + 1);
    if (next === "(" || next === ":") return null;
    const seconds = parseTime(text);
    if (seconds === null || noteVideos(state.doc.toString()).length === 0) return null;
    return new TimeButton(text.slice(1, -1), seconds);
  }

  const [open, close] = node.getChildren("LinkMark");
  if (!open || !close) return null;
  const label = state.doc.sliceString(open.to, close.from);
  const address = linkAddress(node, state.doc);
  if (!BARE.test(label) || address === null) return null;
  const start = START.exec(address);
  const id = videoId(address);
  if (start === null || id === null || !noteVideos(state.doc.toString()).includes(id)) return null;
  return new TimeButton(label, Number(start[1]));
}

/**
 * Draws the time as a button over its source, off the cursor's line.
 *
 * Called ahead of the ordinary link, so a take's link is drawn as the button and
 * not as a link with a click that opens the address. Returns whether it drew.
 * Hidden the way a ruby is, so the cursor cannot rest inside the source the
 * button stands for.
 */
export function drawTime(walk: Walk, node: SyntaxNode, revealed: boolean): boolean {
  if (revealed) return false;
  const button = timeOf(walk.state, node);
  if (button === null) return false;
  walk.decorations.push(Decoration.replace({ widget: button }).range(node.from, node.to));
  walk.hidden.push(HIDDEN.range(node.from, node.to));
  walk.drawn = node.to;
  return true;
}
