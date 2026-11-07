/**
 * Two-finger pinch and double tap on the pdf box (#991), read off touch events and handed to the view as zooms.
 * A mouse's ctrl+wheel and trackpad pinch become zooms too (#1285). The listeners are not passive, or the cancel is ignored.
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
  /** One turn of ctrl+wheel, `factor` times the zoom about `at`; the view ends the zoom once they stop. */
  wheel(factor: number, at: BoxPoint): void;
}

/** The most one turn of ctrl+wheel zooms by, which a mouse notch of 100 px or three lines reaches. */
export const WHEEL_STEP = 1.2;

/** How long and how far apart two taps may be to make a double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
/** How far a finger may move and still tap. */
const TAP_SLOP_PX = 10;

/** Listens on `box` until it is dropped, the box being made new for every open. */
export function listenForPinch(box: HTMLElement, view: Pinched): void {
  const point = (touch: { clientX: number; clientY: number }): BoxPoint => {
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

  // Safari's trackpad pinch, gesture events with `scale` counted from where it
  // began, which no other browser sends. An iPhone sends them under a touch
  // pinch too, which has the zoom, and starts one as soon as the first finger
  // is down, before the second's touchstart: so they are dropped while any
  // finger is on the box.
  type Gesture = Event & { scale: number; clientX: number; clientY: number };
  let gesture = false;
  const gestured = (handle: (event: Gesture) => void) => (event: Event) => {
    event.preventDefault();
    handle(event as Gesture);
  };
  box.addEventListener(
    "gesturestart",
    gestured((event) => {
      if (!view.ready() || spread !== null || touch !== null) return;
      gesture = true;
      view.begin(point(event));
    }),
    { passive: false },
  );
  box.addEventListener(
    "gesturechange",
    gestured((event) => {
      if (gesture) view.move(event.scale, point(event));
    }),
    { passive: false },
  );
  box.addEventListener(
    "gestureend",
    gestured(() => {
      if (!gesture) return;
      gesture = false;
      view.end();
    }),
    { passive: false },
  );

  // ctrl+wheel, which is also how Chrome, Edge and Firefox send a trackpad
  // pinch, and cmd+wheel on a Mac. A trackpad's pixels are the fingers' own
  // scale, e to the minus a hundredth of them, as Chrome makes them; one turn
  // is held to `WHEEL_STEP`, so a mouse notch zooms by a step and not to a limit.
  const most = 100 * Math.log(WHEEL_STEP);
  box.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // Cancelled while the pdf opens too, or the browser zooms the app.
      event.preventDefault();
      if (!view.ready() || spread !== null || gesture) return;
      const px =
        event.deltaY *
        (event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? box.clientHeight
            : 1);
      view.wheel(Math.exp(-Math.max(-most, Math.min(most, px)) / 100), point(event));
    },
    { passive: false },
  );
}
