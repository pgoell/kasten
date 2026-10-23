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
 * The gap a button keeps under a selection on a touch screen. The phone draws
 * its own copy menu above the words and the handles below them, so the button
 * sits clear of both.
 */
const BELOW_GAP = 32;

/**
 * A message's selection, checked field by field, or null for anything else. A
 * page's message is data this pane does not trust, so nothing is read before it
 * is known to be the right shape.
 */
export function selectionOf(data: Record<string, unknown>): Selection | null {
  const { text, heading, anchor, rect } = data;
  if (typeof text !== "string" || typeof heading !== "string" || typeof anchor !== "string") {
    return null;
  }
  // The page's script keeps to these lengths, but a forged message skips the
  // script, so the pane holds them too.
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

/** `value` cut to `max` code points, which is how the script counts them too. */
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
  /** The wrapper's own size, which is what the button must stay inside. */
  box: { width: number; height: number };
}

/**
 * Whether the button sits in the lower half of the frame, where a toast at the
 * foot would cover the passage (#885). A take with no place keeps the foot.
 */
export function low(at: Anchor | null): boolean {
  return at !== null && at.y > at.box.height / 2;
}

/**
 * Where the button goes for a selection, in the wrapper's own px, before it is
 * fitted to the wrapper. Above the words with a fine pointer, where the mouse
 * is; below them on a touch screen, clear of the phone's own menu.
 */
export function placeFor(
  frame: HTMLIFrameElement,
  wrapper: HTMLDivElement,
  rect: Rect,
  coarse: boolean,
): Anchor {
  const outer = frame.getBoundingClientRect();
  const box = wrapper.getBoundingClientRect();
  const x = outer.left + rect.left + (rect.right - rect.left) / 2 - box.left;
  const size = { width: box.width, height: box.height };
  if (coarse) {
    return { x, y: outer.top + rect.bottom + BELOW_GAP - box.top, above: false, box: size };
  }
  return { x, y: outer.top + rect.top - box.top, above: true, box: size };
}

/**
 * The button's left and top, with its whole box inside the wrapper. The button
 * is centred on `x` by its own transform, and hangs above `y` or below it, so
 * the limits are its half width on each side and its full height on one side.
 *
 * `size` is the button as drawn, which only the pane can measure, so this runs
 * on the measured size and not on a guess.
 */
export function fitButton(at: Anchor, size: { width: number; height: number }) {
  const { x, y, above, box } = at;
  const left = Math.min(Math.max(x, size.width / 2), box.width - size.width / 2);
  const top = above
    ? Math.min(Math.max(y, size.height), box.height)
    : Math.min(Math.max(y, 0), box.height - size.height);
  return { left, top };
}
