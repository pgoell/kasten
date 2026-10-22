/**
 * A bottom sheet: a solid panel that rises from the foot of the screen over a
 * scrim, and goes down by a flick, a drag past halfway, Esc or a tap on the scrim.
 *
 * The panel moves by `transform` and the scrim by `opacity`, and both are
 * written straight to the DOM from the spring's frames. A drag runs at the
 * frame rate that way, and never waits on a render. The panel is solid paper
 * with no blur behind it, since a sheet is read, and a blur would smear the
 * note under it into something worse than a dimmed one.
 */

import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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

// Read on each use rather than once, so a change of the setting while a sheet
// is up is honoured by the next gesture.
function reducedMotion(): boolean {
  return matchMedia(REDUCED).matches;
}

export function Sheet({ open, onClose, label, header, children }: SheetProps) {
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
  const fading = useRef<((done: boolean) => void) | null>(null);

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

  // Down to the bottom, by spring or by fade. Resolves true only if nothing
  // interrupted it, which is when the sheet may be taken out of the DOM.
  function leave(config: SpringConfig, velocity?: number): Promise<boolean> {
    if (reducedMotion()) return fadeTo(0);
    return spring.to(height.current, config, velocity);
  }

  function finish() {
    resting.current = true;
    setMounted(false);
    const back = returnTo.current;
    returnTo.current = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
  }

  // A close the sheet makes itself, so it tells the parent once it is gone.
  function dismiss(config: SpringConfig, velocity?: number) {
    void leave(config, velocity).then((done) => {
      if (!done) return;
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
        if (done) finish();
      });
      return;
    }

    if (resting.current) returnTo.current = document.activeElement;
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
    // Mounted at its own height and springing up from there. A sheet that
    // turns round mid-leave keeps where it is, so it does not jump.
    if (resting.current) spring.set(height.current);
    resting.current = false;
    void spring.to(0, SPRINGS.sheetOpen);
  }, [open]);

  // A press catches the sheet where it is, so a finger lands mid-flight. The
  // drag is decided later, once the finger has moved far enough to be one.
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const hold = event.target.closest("[data-sheet-drag]");
    if (!hold) return;
    swallow.current = false;
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
        if (open) void spring.to(0, SPRINGS.sheetOpen);
        else dismiss(SPRINGS.sheetClose);
      }
      return;
    }

    swallow.current = true;
    if (cancelled) {
      void spring.to(0, SPRINGS.sheetClose);
      return;
    }
    const v = speed(held.samples, performance.now());
    if (closes(spring.value, v, height.current)) {
      dismiss(afterRelease(SPRINGS.sheetClose, v), v);
    } else {
      void spring.to(0, afterRelease(SPRINGS.sheetClose, v), v);
    }
  }

  return mounted ? (
    <>
      <div
        ref={scrim}
        aria-hidden="true"
        onClick={() => dismiss(SPRINGS.sheetClose)}
        className="fixed inset-0 z-40 bg-black/30"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event, false)}
        onPointerCancel={(event) => onPointerEnd(event, true)}
        // Capture, so the keys never reach the editor under the sheet, vim's Esc among them.
        onKeyDownCapture={(event) => {
          // A key is a choice made after the drag, so the click it leads to is not the drag's.
          swallow.current = false;
          if (event.key !== "Escape") return;
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
          if (event.target !== panel.current || event.propertyName !== "opacity") return;
          fading.current?.(true);
          fading.current = null;
        }}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-[var(--k-radius-8)] bg-k-paper shadow-[var(--k-shadow)] outline-none safe-foot"
      >
        <div data-sheet-drag className="flex h-11 shrink-0 items-center justify-center">
          <span className="h-[5px] w-9 rounded-full bg-k-rule-strong opacity-25" />
        </div>
        {header !== undefined && (
          <div data-sheet-drag className="shrink-0 px-4 pb-2">
            {header}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </>
  ) : null;
}
