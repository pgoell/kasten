/**
 * A bottom sheet: a solid panel that rises from the foot of the screen over a
 * scrim, and goes down by a flick, a drag past halfway, Esc or a tap on the scrim.
 *
 * The panel moves by `transform` and the scrim by `opacity`, and both are
 * written straight to the DOM from the spring's frames. A drag runs at the
 * frame rate that way, and never waits on a render. The panel is solid paper
 * with no blur behind it, since a sheet is read, and a blur would smear the
 * note under it into something worse than a dimmed one.
 *
 * With `side` it is the desktop side sheet instead: a 540 px panel at the right
 * edge of the nearest positioned ancestor. It slides on a plain ease-out, with
 * no spring and no drag.
 */

import {
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { trapTab } from "@/lib/focus-trap";
import { axis, backdrop, closes, follow, type Sample, speed } from "@/lib/sheet-math";
import { afterRelease, SPRINGS, Spring, type SpringConfig } from "@/lib/spring";

interface SheetProps {
  /** Whether the sheet is wanted. Going false takes it down the way a drag does. */
  open: boolean;
  /** Called once the sheet has gone down by a drag, Esc or the scrim. The parent then sets `open` false. */
  onClose: () => void;
  label: string;
  /** Drawn under the grabber. Dragging it drags the sheet, as the grabber does. */
  header?: ReactNode;
  /** Pinned at the foot, under the scrolling content, so it is always in sight. */
  footer?: ReactNode;
  /** The desktop side sheet: a 540 px panel at the right edge, a plain slide, no drag. */
  side?: boolean;
  /** A bottom sheet that is the whole screen, up to the top safe area, not capped at 88dvh. */
  full?: boolean;
  /** Whether the focus goes back to what held it when the sheet leaves. False where a command took the focus. */
  restoreFocus?: boolean;
  /** A bottom sheet that rides on the on-screen keyboard, so what is pinned in it stays in sight. */
  lift?: boolean;
  children: ReactNode;
}

interface Gesture {
  pointer: number;
  x: number;
  y: number;
  /** The offset the sheet had when the finger went down. */
  start: number;
  /** The element the pointer is held on once the drag is decided. */
  hold: Element;
  axis: "pending" | "drag" | "scroll";
  /** Whether the spring was still moving when the finger went down, which the tap then resumes. */
  interrupted: boolean;
  captured: boolean;
  samples: Sample[];
}

const REDUCED = "(prefers-reduced-motion: reduce)";

const BOTTOM_PANEL =
  "fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[var(--k-radius-8)] bg-k-paper shadow-[var(--k-shadow)] outline-none safe-foot";
const CAPPED = "max-h-[88dvh]";
// A sheet that is the whole screen stops at the notch's inset, so its top edge is under it.
const WHOLE = "h-[calc(100dvh-env(safe-area-inset-top))]";
const SIDE_PANEL =
  "absolute inset-y-0 right-0 z-50 flex w-[540px] max-w-full flex-col border-l border-k-rule bg-k-paper shadow-[var(--k-shadow)] outline-none";

// Read on each use rather than once, so a change of the setting while a sheet
// is up is honoured by the next gesture.
function reducedMotion(): boolean {
  return matchMedia(REDUCED).matches;
}

// Whether the side panel's edge already sits where a slide to `shown` leaves it.
// Reading the rect forces the style, so a slide still running reads as not there yet.
function sideAt(el: HTMLElement, shown: boolean): boolean {
  const box = el.offsetParent?.getBoundingClientRect();
  if (!box) return true;
  const rect = el.getBoundingClientRect();
  const edge = shown ? rect.right : rect.left;
  return Math.abs(edge - box.right) < 0.5;
}

export function Sheet({
  open,
  onClose,
  label,
  side = false,
  full = false,
  restoreFocus = true,
  lift = false,
  header,
  footer,
  children,
}: SheetProps) {
  // Rendered from the moment it is wanted until its leave has run. The change
  // is made during render, the way React documents for a prop that changes
  // what is shown. `seen` is its own flag, because a sheet that closed itself
  // stays closed while `open` still reads true, and must not come back.
  const [mounted, setMounted] = useState(open);
  const [seen, setSeen] = useState(open);
  if (open !== seen) {
    setSeen(open);
    if (open) setMounted(true);
  }

  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  // True while the sheet is down and out of the DOM, so the next open starts
  // from the bottom rather than wherever the last drag left it.
  const resting = useRef(true);
  const gesture = useRef<Gesture | null>(null);
  // Set by a drag, so the click a release may send is not a tap. Cleared by that click,
  // by any key, and by the next press, so a later activation is never eaten.
  const swallow = useRef(false);
  const returnTo = useRef<Element | null>(null);
  // Read at the leave's end, not the open's, so a caller can decide after the sheet is up.
  const restore = useRef(restoreFocus);
  restore.current = restoreFocus;
  // Set while the sheet is closing by its own hand (Esc, the scrim, a flick), so a
  // tap that interrupts that close resumes it rather than reopening the sheet.
  const dismissing = useRef(false);
  const fading = useRef<((done: boolean) => void) | null>(null);
  // Set from the first moment the sheet is leaving until it is opened again, so a
  // side sheet's outside press or focus loss does not ask for a second close.
  const closing = useRef(false);
  // The latest close, for the outside listeners, which are set up once per open.
  const closeFromOutside = useRef<() => void>(() => {});

  const paint = (offset: number) => {
    if (panel.current) panel.current.style.transform = `translate3d(0, ${offset}px, 0)`;
    // Under reduced motion the fade owns the scrim's opacity, so it is left alone.
    if (scrim.current && !reducedMotion()) {
      scrim.current.style.opacity = String(backdrop(offset, height.current));
    }
  };
  const [spring] = useState(() => new Spring(0, paint));

  useEffect(() => () => spring.stop(), [spring]);

  // The reduced-motion path. Opacity is moved by a CSS transition, which is
  // the only motion a reduced sheet makes. `transitionend` says when it ended;
  // with no transition at all (or the same value) there is no event, so the
  // answer is given now.
  function fadeTo(to: 0 | 1): Promise<boolean> {
    const el = panel.current;
    const scrimEl = scrim.current;
    if (!el || !scrimEl) return Promise.resolve(false);
    fading.current?.(false);
    return new Promise((resolve) => {
      const from = getComputedStyle(el).opacity;
      el.style.transition = "opacity var(--k-hover) var(--k-ease-out)";
      scrimEl.style.transition = "opacity var(--k-hover) var(--k-ease-out)";
      el.style.opacity = String(to);
      scrimEl.style.opacity = String(to);
      const instant = parseFloat(getComputedStyle(el).transitionDuration) === 0;
      if (from === String(to) || instant) resolve(true);
      else fading.current = resolve;
    });
  }

  // The side sheet's slide: the panel moves by transform and the scrim fades
  // with it, on one ease-out. A plain slide, so no spring writes either.
  function slideTo(shown: boolean): Promise<boolean> {
    const el = panel.current;
    const scrimEl = scrim.current;
    if (!el || !scrimEl) return Promise.resolve(false);
    fading.current?.(false);
    return new Promise((resolve) => {
      el.style.transition = "transform var(--k-slide) var(--k-ease-out)";
      scrimEl.style.transition = "opacity var(--k-slide) var(--k-ease-out)";
      el.style.transform = shown ? "none" : "translateX(100%)";
      scrimEl.style.opacity = shown ? "1" : "0";
      // A change that moves nothing starts no transition, so no transitionend comes
      // for it. That is a slide asked back in the same frame it began, and waiting
      // on that event would strand the panel.
      if (sideAt(el, shown)) resolve(true);
      else fading.current = resolve;
    });
  }

  // Down to the bottom, by spring or by fade. Resolves true only if nothing
  // interrupted it, which is when the sheet may be taken out of the DOM.
  function leave(config: SpringConfig, velocity?: number): Promise<boolean> {
    closing.current = true;
    measure();
    if (reducedMotion()) return fadeTo(0);
    if (side) return slideTo(false);
    return spring.to(height.current, config, velocity);
  }

  // Read again whenever the sheet is about to move, since content such as the
  // graph arrives after the sheet has opened and changes how far down it goes.
  function measure() {
    if (panel.current) height.current = panel.current.offsetHeight;
  }

  function finish() {
    resting.current = true;
    dismissing.current = false;
    setMounted(false);
    const back = returnTo.current;
    returnTo.current = null;
    if (restore.current && back instanceof HTMLElement && back.isConnected)
      back.focus({ preventScroll: true });
  }

  // A close the sheet makes itself, so it tells the parent once it is gone.
  function dismiss(config: SpringConfig, velocity?: number) {
    dismissing.current = true;
    void leave(config, velocity).then((done) => {
      if (!done || !closing.current) return;
      finish();
      onClose();
    });
  }

  // Keyed on `open` alone: the helpers it calls read only refs and the spring,
  // which never change, so a re-run would only repeat the move.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useLayoutEffect(() => {
    const el = panel.current;
    // Already out of the DOM: a close the sheet made itself, which the parent now echoes.
    if (!el) return;
    if (!open) {
      void leave(SPRINGS.sheetClose).then((done) => {
        // A leave that resolves after a reopen must not unmount the sheet the reopen showed.
        if (done && closing.current) finish();
      });
      return;
    }

    if (resting.current) returnTo.current = document.activeElement;
    dismissing.current = false;
    closing.current = false;
    height.current = el.offsetHeight;
    el.focus({ preventScroll: true });
    if (reducedMotion()) {
      paint(0);
      if (resting.current) {
        // Set without a transition, so the fade starts from nothing rather than from full.
        el.style.opacity = "0";
        if (scrim.current) scrim.current.style.opacity = "0";
        void el.offsetHeight;
      }
      resting.current = false;
      void fadeTo(1);
      return;
    }
    if (side) {
      // Set from the edge without a transition, so the slide starts there and not from wherever it was.
      if (resting.current) {
        el.style.transition = "none";
        el.style.transform = "translateX(100%)";
        if (scrim.current) scrim.current.style.opacity = "0";
        void el.offsetHeight;
      }
      resting.current = false;
      void slideTo(true);
      return;
    }
    // Mounted at its own height and springing up from there. A sheet that
    // turns round mid-leave keeps where it is, so it does not jump.
    if (resting.current) spring.set(height.current);
    resting.current = false;
    void spring.to(0, SPRINGS.sheetOpen);
  }, [open]);

  useEffect(() => {
    closeFromOutside.current = () => {
      if (closing.current) return;
      // The user has put the focus where they want it, so the close must not move it back.
      returnTo.current = null;
      dismiss(SPRINGS.sheetClose);
    };
  });

  // A side sheet sits over one pane, so a press in another pane or the tab strip
  // must close it too, as the scrim does. The listener is capture-phase and does
  // not stop the press, so what was pressed still gets it.
  useEffect(() => {
    if (!side || !open) return;
    const press = (event: PointerEvent) => {
      // The scrim is outside the panel but closes the sheet itself, with the focus returned.
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      if (event.target instanceof Node && scrim.current?.contains(event.target)) return;
      closeFromOutside.current();
    };
    document.addEventListener("pointerdown", press, true);
    return () => document.removeEventListener("pointerdown", press, true);
  }, [side, open]);

  // A press catches the sheet where it is, so a finger lands mid-flight. The
  // drag is decided later, once the finger has moved far enough to be one.
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // A side sheet has no grabber and does not drag.
    if (side) return;
    // Cleared for every press, the grabber or the content, so a release that sent no
    // click cannot eat the next tap wherever it lands.
    swallow.current = false;
    if (!(event.target instanceof Element)) return;
    const hold = event.target.closest("[data-sheet-drag]");
    if (!hold) return;
    measure();
    const interrupted = spring.moving;
    spring.stop();
    gesture.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: spring.value,
      hold,
      axis: "pending",
      interrupted,
      captured: false,
      samples: [],
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const held = gesture.current;
    if (!held || event.pointerId !== held.pointer) return;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    if (held.axis === "pending") held.axis = axis(dx, dy);
    // Sideways gives the gesture up for good, so a later vertical move does not move the sheet.
    if (held.axis !== "drag") return;
    // A drag has taken the sheet over, so a close it was making is no longer the sheet's own.
    dismissing.current = false;
    // Held so the finger keeps the sheet even when it leaves the grabber.
    if (!held.captured) {
      held.hold.setPointerCapture(held.pointer);
      held.captured = true;
    }
    held.samples.push({ t: performance.now(), y: event.clientY });
    spring.set(follow(held.start + dy, height.current));
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const held = gesture.current;
    if (!held || event.pointerId !== held.pointer) return;
    gesture.current = null;

    if (held.axis !== "drag") {
      // A tap that landed on a sheet still coming to rest is a tap on the sheet, so
      // the sheet goes on to where it was heading.
      if (held.interrupted) {
        if (open && !dismissing.current) void spring.to(0, SPRINGS.sheetOpen);
        else dismiss(SPRINGS.sheetClose);
      }
      return;
    }

    swallow.current = true;
    if (cancelled) {
      dismissing.current = false;
      void spring.to(0, SPRINGS.sheetClose);
      return;
    }
    const v = speed(held.samples, performance.now());
    if (closes(spring.value, v, height.current)) {
      dismiss(afterRelease(SPRINGS.sheetClose, v), v);
    } else {
      dismissing.current = false;
      void spring.to(0, afterRelease(SPRINGS.sheetClose, v), v);
    }
  }

  // Under reduced motion a side sheet fades, so its end is an opacity, not a transform.
  const ended = side && !reducedMotion() ? "transform" : "opacity";

  return mounted ? (
    <>
      <div
        ref={scrim}
        aria-hidden="true"
        onClick={() => dismiss(SPRINGS.sheetClose)}
        className={side ? "absolute inset-0 z-40 bg-black/30" : "fixed inset-0 z-40 bg-black/30"}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onBlur={(event: ReactFocusEvent<HTMLDivElement>) => {
          // Focus going to nothing (relatedTarget null) is not a move to another element, so it stays.
          const to = event.relatedTarget;
          if (side && to instanceof Node && !event.currentTarget.contains(to))
            closeFromOutside.current();
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event, false)}
        onPointerCancel={(event) => onPointerEnd(event, true)}
        onKeyDown={(event) => {
          // A key is a choice made after the drag, so the click it leads to is not the drag's.
          swallow.current = false;
          // Tab stays in the sheet: the last stop wraps to the first, and the reverse.
          if (panel.current) trapTab(event, panel.current);
          if (event.key !== "Escape" || event.defaultPrevented) return;
          // Stopped here so the keys never reach the editor under the sheet, vim's Esc among them.
          event.stopPropagation();
          dismiss(SPRINGS.sheetClose);
        }}
        // Capture, so a click that ends a drag stops at the sheet and fires nothing.
        onClickCapture={(event) => {
          if (!swallow.current) return;
          // One click only: a release sends at most one, and a later tap must not be eaten.
          swallow.current = false;
          event.stopPropagation();
          event.preventDefault();
        }}
        onTransitionEnd={(event) => {
          if (event.target !== panel.current || event.propertyName !== ended) return;
          fading.current?.(true);
          fading.current = null;
        }}
        // The keyboard's height is a custom property the page sets, read here so the foot clears it.
        style={!side && lift ? { bottom: "var(--keyboard, 0px)" } : undefined}
        className={side ? SIDE_PANEL : `${BOTTOM_PANEL} ${full ? WHOLE : CAPPED}`}
      >
        {!side && (
          <div data-sheet-drag className="flex h-11 shrink-0 items-center justify-center">
            <span className="h-[5px] w-9 rounded-full bg-k-rule-strong opacity-25" />
          </div>
        )}
        {header !== undefined && (
          <div
            data-sheet-drag={side ? undefined : true}
            className={side ? "shrink-0 px-4 pt-3 pb-2" : "shrink-0 px-4 pb-2"}
          >
            {header}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer !== undefined && <div className="shrink-0">{footer}</div>}
        {/* Paper below the foot. A spring that overshoots the rest point lifts the foot
            clear of the screen's edge, and the note must not show through that gap. */}
        {!side && (
          <div
            data-sheet-skirt
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-full h-[50dvh] bg-k-paper"
          />
        )}
      </div>
    </>
  ) : null;
}
