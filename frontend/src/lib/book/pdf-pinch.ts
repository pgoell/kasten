/**
 * Two fingers and a double tap on the pdf pane's box (#991), read off touch
 * events and handed to the view as zooms about a point. A mouse sends no touch
 * events, so the desktop is left as it was.
 *
 * The box's `touch-action: pan-x pan-y` (pdf-pane.css) keeps the browser from
 * zooming the whole app under two fingers while one finger still scrolls
 * natively; the two-finger moves are cancelled here too, for a browser that
 * does not honour it. The listeners are not passive, or the cancel is ignored.
 */

/** A point in the box, in CSS px from its top left corner. */
export interface BoxPoint {
  x: number;
  y: number;
}

/** What the gestures ask of the view. */
export interface Pinched {
  /** Whether the pages are laid out, so there is something to zoom. */
  ready(): boolean;
  /** Two fingers went down about `at`. */
  begin(at: BoxPoint): void;
  /** They are now `scale` times as far apart as they began, about `at`. */
  move(scale: number, at: BoxPoint): void;
  /** One of them lifted. */
  end(): void;
  /** A second tap at `at` soon after a first near it. */
  doubleTap(at: BoxPoint): void;
}

/** How long and how far apart two taps may be to make a double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
/** How far a finger may move and still tap. */
const TAP_SLOP_PX = 10;

/** Listens on `box` until it is dropped, the box being made new for every open. */
export function listenForPinch(box: HTMLElement, view: Pinched): void {
  const point = (touch: Touch): BoxPoint => {
    const rect = box.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  };
  const between = (touches: TouchList) => {
    const a = point(touches[0] as Touch);
    const b = point(touches[1] as Touch);
    return {
      middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      spread: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };
  // The fingers' spread when the pinch began, while one is under way.
  let spread: number | null = null;
  // The last tap, for the double tap, and the touch under way: where it went
  // down and whether it has moved or pinched since, which makes it no tap.
  let tapped: { time: number; at: BoxPoint } | null = null;
  let touch: { at: BoxPoint; tap: boolean } | null = null;

  box.addEventListener(
    "touchstart",
    (event) => {
      if (!view.ready()) return;
      if (event.touches.length === 1) {
        touch = { at: point(event.touches[0] as Touch), tap: true };
        return;
      }
      if (touch !== null) touch.tap = false;
      if (event.touches.length !== 2) return;
      event.preventDefault();
      const start = between(event.touches);
      spread = start.spread;
      view.begin(start.middle);
    },
    { passive: false },
  );

  box.addEventListener(
    "touchmove",
    (event) => {
      if (spread === null || event.touches.length !== 2) {
        const at = event.touches.length === 1 ? point(event.touches[0] as Touch) : null;
        if (
          touch !== null &&
          at !== null &&
          Math.hypot(at.x - touch.at.x, at.y - touch.at.y) > TAP_SLOP_PX
        )
          touch.tap = false;
        return;
      }
      event.preventDefault();
      const now = between(event.touches);
      view.move(now.spread / spread, now.middle);
    },
    { passive: false },
  );

  const lifted = (event: TouchEvent) => {
    if (spread !== null && event.touches.length < 2) {
      spread = null;
      view.end();
    }
    if (event.touches.length > 0) return;
    const done = touch;
    touch = null;
    if (done === null || !done.tap || event.type === "touchcancel") return;
    const last = tapped;
    tapped = { time: event.timeStamp, at: done.at };
    if (
      last === null ||
      event.timeStamp - last.time > DOUBLE_TAP_MS ||
      Math.hypot(done.at.x - last.at.x, done.at.y - last.at.y) > DOUBLE_TAP_PX
    )
      return;
    // The second tap of a double tap, which the browser would otherwise take
    // for a click and a word's selection.
    event.preventDefault();
    tapped = null;
    view.doubleTap(done.at);
  };
  box.addEventListener("touchend", lifted);
  box.addEventListener("touchcancel", lifted);
}
