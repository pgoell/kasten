/** A selection's place in the frame's own viewport, in px. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A selection as the page reports it, with its rectangle or null where it has none. */
export interface Selection {
  text: string;
  heading: string;
  anchor: string;
  rect: Rect | null;
}

/**
 * Whether `next` repeats the passage `was` already sent. A scroll or a mouseup before
 * Share can send it again (#877).
 */
export function samePassage(was: Omit<Selection, "rect"> | undefined, next: Selection): boolean {
  return was?.text === next.text && was.heading === next.heading && was.anchor === next.anchor;
}

/** Gap under a touch selection, clear of the phone's handles and copy menu. */
const BELOW_GAP = 32;

/**
 * A page message's selection, or null for anything else. The message is untrusted data,
 * so every field is checked before it is read.
 */
export function selectionOf(data: Record<string, unknown>): Selection | null {
  const { text, heading, anchor, rect } = data;
  if (typeof text !== "string" || typeof heading !== "string" || typeof anchor !== "string") {
    return null;
  }
  // The page's script keeps to these lengths, but a forged message skips it.
  const words = {
    text: clip(text, TEXT_MAX),
    heading: clip(heading, HEADING_MAX),
    anchor: clip(anchor, ANCHOR_MAX),
  };
  if (rect === null) return { ...words, rect: null };
  if (typeof rect !== "object" || rect === null) return null;

  const { left, top, right, bottom } = rect as Record<string, unknown>;
  if (!finite(left) || !finite(top) || !finite(right) || !finite(bottom)) return null;
  return { ...words, rect: { left, top, right, bottom } };
}

/** The script's limits on what it sends, in code points. */
const TEXT_MAX = 10000;
const HEADING_MAX = 300;
const ANCHOR_MAX = 200;

/** `value` cut to `max` code points, counted as the script counts them. */
function clip(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Where a button wants to be: the middle of the words, and the edge it hangs from. */
export interface Anchor {
  x: number;
  y: number;
  above: boolean;
  /** The passage's middle, which is where the words sit whatever the button's edge. */
  middle: number;
  /** The wrapper's own size, which is what the button must stay inside. */
  box: { width: number; height: number };
}

/**
 * Whether the passage's middle is in the lower half of the frame, where a toast at the
 * foot would cover the words (#885). No place keeps the foot.
 */
export function low(at: Anchor | null): boolean {
  return at !== null && at.middle > at.box.height / 2;
}

/**
 * Where the button goes, in the wrapper's px, before fitting. Above the words for a mouse,
 * below them on touch.
 */
export function placeFor(
  frame: Element,
  wrapper: HTMLDivElement,
  rect: Rect,
  coarse: boolean,
): Anchor {
  const outer = frame.getBoundingClientRect();
  const box = wrapper.getBoundingClientRect();
  const x = outer.left + rect.left + (rect.right - rect.left) / 2 - box.left;
  const middle = outer.top + (rect.top + rect.bottom) / 2 - box.top;
  const size = { width: box.width, height: box.height };
  if (coarse) {
    const y = outer.top + rect.bottom + BELOW_GAP - box.top;
    return { x, y, above: false, middle, box: size };
  }
  return { x, y: outer.top + rect.top - box.top, above: true, middle, box: size };
}

/**
 * The button's left and top, with its whole box inside the wrapper. `size` is the button
 * as the pane measured it, not a guess.
 */
export function fitButton(at: Anchor, size: { width: number; height: number }) {
  const { x, y, above, box } = at;
  const left = Math.min(Math.max(x, size.width / 2), box.width - size.width / 2);
  const top = above
    ? Math.min(Math.max(y, size.height), box.height)
    : Math.min(Math.max(y, 0), box.height - size.height);
  return { left, top };
}
