/**
 * A flashcard a finger can grade. A touch tap on it reveals the answer, and a
 * sideways swipe grades it: right is Good, left is Again. The grade buttons
 * stay beside it, so the swipe is an extra and never the only way.
 *
 * The card moves by `transform` and the stamps by `opacity`, both written
 * straight to the DOM from the spring's frames, as the sheet does. A mouse or a
 * pen is ignored, so selecting text on a desktop keeps working.
 */

import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { stampOf, swipeGrade, tiltOf } from "@/lib/card-swipe";
import { gradeTick } from "@/lib/haptic";
import { axis, type Sample, SLOP, speed } from "@/lib/sheet-math";
import { afterRelease, SPRINGS, Spring } from "@/lib/spring";

interface SwipeCardProps {
  /** Whether a swipe may grade the card. False makes the card still to a finger. */
  swipe: boolean;
  onGrade: (rating: "good" | "again") => void;
  /** Called for a touch tap that is not on a control inside the card. */
  onTap?: () => void;
  /** Called true when a grade sends the card off, and false once it has landed, before `onGrade`, or on unmount. */
  onFlight?: (flying: boolean) => void;
  children: ReactNode;
  className?: string;
}

interface Gesture {
  pointer: number;
  x: number;
  y: number;
  /** The offset the card had when the finger went down, so a press mid-spring picks up from there. */
  start: number;
  /** The furthest the finger has strayed from where it went down, in px. Under SLOP it is a tap. */
  reach: number;
  /** The press began on a link, so a tap on it is the link's, though a swipe still grades the card. */
  onLink: boolean;
  /** The press began on a media or native widget, so neither a tap nor a swipe is the card's. */
  onControl: boolean;
  /** Set once the drag is horizontal and allowed: the card follows the finger. */
  decided: boolean;
  /** Set when the gesture is over for grading: a vertical drag, a swipe that is off, or a second finger. */
  dead: boolean;
  samples: Sample[];
}

/**
 * Where a press belongs to a control inside the card, so the card neither taps nor swipes on it:
 * a seek bar's drag is the bar's. A read-only CodeMirror view marks its text contenteditable="false",
 * so only the editable ones count.
 */
const CONTROL =
  'audio, button, input, select, summary, textarea, video, [role="slider"], [contenteditable]:not([contenteditable="false"])';

/** A link inside the card: a tap is the link's, but a swipe that starts on it still grades. */
const LINK = "a";

/** Right is Good, left is Again. The stamps sit at the top corners on the side they name. */
const STAMP =
  "pointer-events-none absolute top-4 z-10 rounded border-2 bg-k-paper px-2 py-0.5 font-sans text-k-13 uppercase";

export function SwipeCard({
  swipe,
  onGrade,
  onTap,
  onFlight,
  children,
  className,
}: SwipeCardProps) {
  const root = useRef<HTMLDivElement>(null);
  const good = useRef<HTMLSpanElement>(null);
  const again = useRef<HTMLSpanElement>(null);
  const gesture = useRef<Gesture | null>(null);
  // Set from the release until the spring lands, so a finger that comes down mid-flight is ignored.
  const flying = useRef(false);
  const alive = useRef(true);
  // Set by a drag, so the click a release may send is not a tap on the card. Cleared by that click
  // and by the next press, so a later tap is never eaten.
  const swallow = useRef(false);
  // The width the stamps are measured against, set when the card is grabbed or released.
  const width = useRef(0);
  // Read on each event, so a change of `swipe` mid-drag is honoured at once.
  const latest = useRef({ swipe, onGrade, onTap, onFlight });
  latest.current = { swipe, onGrade, onTap, onFlight };

  const paint = (offset: number) => {
    if (root.current)
      root.current.style.transform = `translateX(${offset}px) rotate(${tiltOf(offset)}deg)`;
    const stamp = stampOf(offset, width.current);
    if (good.current)
      good.current.style.opacity = String(stamp.rating === "good" ? stamp.opacity : 0);
    if (again.current)
      again.current.style.opacity = String(stamp.rating === "again" ? stamp.opacity : 0);
  };
  const [spring] = useState(() => new Spring(0, paint));

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      spring.stop();
      // A flight cut short by unmounting never lands, so the parent is told it is over with no grade.
      if (flying.current) {
        flying.current = false;
        latest.current.onFlight?.(false);
      }
    };
  }, [spring]);

  // React attaches touchmove as passive, and a passive listener cannot stop the page
  // from panning sideways. Native and non-passive, it can, once the drag is decided.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const move = (event: TouchEvent) => {
      if (gesture.current?.decided) event.preventDefault();
    };
    el.addEventListener("touchmove", move, { passive: false });
    return () => el.removeEventListener("touchmove", move);
  }, []);

  function widthOf(): number {
    return root.current?.getBoundingClientRect().width ?? 0;
  }

  // The gesture ends without a grade: a cancel, or the pointer being taken away from the card.
  function abandon(pointer: number) {
    const held = gesture.current;
    if (!held || held.pointer !== pointer) return;
    gesture.current = null;
    if (held.decided) {
      swallow.current = true;
      void spring.to(0, SPRINGS.sheetClose);
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" || flying.current) return;
    const held = gesture.current;
    if (held) {
      // A second finger ends the first one's drag, and nothing is graded.
      if (!held.dead) {
        held.dead = true;
        if (held.decided) {
          swallow.current = true;
          void spring.to(0, SPRINGS.sheetClose);
        }
      }
      return;
    }
    swallow.current = false;
    spring.stop();
    gesture.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: spring.value,
      reach: 0,
      onLink: event.target instanceof Element && event.target.closest(LINK) !== null,
      onControl: event.target instanceof Element && event.target.closest(CONTROL) !== null,
      decided: false,
      dead: false,
      samples: [{ t: performance.now(), y: event.clientX }],
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const held = gesture.current;
    if (!held || held.dead || event.pointerId !== held.pointer) return;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    held.reach = Math.max(held.reach, Math.abs(dx), Math.abs(dy));

    // Turned off mid-drag: the card springs back and grades nothing.
    if (held.decided && !latest.current.swipe) {
      held.dead = true;
      swallow.current = true;
      void spring.to(0, SPRINGS.sheetClose);
      return;
    }
    if (!held.decided) {
      // A press on a control is the control's: its own sideways drag, a seek bar say, is not a swipe.
      if (held.onControl) {
        held.dead = true;
        return;
      }
      // axis() calls a vertical win "scroll", so the arguments are swapped to make its "drag" the sideways one.
      const verdict = axis(dy, dx);
      if (verdict === "pending") return;
      // Vertical is the page's. The rest of this gesture is left to scrolling.
      if (verdict === "scroll" || !latest.current.swipe) {
        held.dead = true;
        return;
      }
      held.decided = true;
      root.current?.setPointerCapture(event.pointerId);
      width.current = widthOf();
    }
    held.samples.push({ t: performance.now(), y: event.clientX });
    spring.set(held.start + dx);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const held = gesture.current;
    if (!held || held.pointer !== event.pointerId) return;
    gesture.current = null;
    if (held.dead) return;

    if (!held.decided) {
      if (held.reach < SLOP && !held.onLink && !held.onControl) latest.current.onTap?.();
      return;
    }

    swallow.current = true;
    const w = widthOf();
    width.current = w;
    const v = speed(held.samples, performance.now());
    const rating = swipeGrade(spring.value, v, w);
    if (!rating) {
      void spring.to(0, afterRelease(SPRINGS.sheetClose, v), v);
      return;
    }

    gradeTick();
    flying.current = true;
    latest.current.onFlight?.(true);
    const sign = rating === "good" ? 1 : -1;
    void spring.to(sign * w * 1.5, SPRINGS.card, v).then(() => {
      flying.current = false;
      // Unmounted mid-flight: the spring was stopped, and the parent no longer wants the grade.
      if (!alive.current) return;
      spring.set(0);
      latest.current.onFlight?.(false);
      latest.current.onGrade(rating);
    });
  }

  return (
    <div
      ref={root}
      data-testid="review-swipe"
      className={className ? `relative ${className}` : "relative"}
      style={{ touchAction: "pan-y", overscrollBehaviorX: "contain" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => abandon(event.pointerId)}
      onLostPointerCapture={(event) => abandon(event.pointerId)}
      // Capture, so the click a drag ends with stops here and reaches no control inside the card.
      onClickCapture={(event) => {
        if (!swallow.current) return;
        // One click only: a release sends at most one, and a later tap must not be eaten.
        swallow.current = false;
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      <span
        ref={good}
        data-stamp="good"
        aria-hidden="true"
        style={{ opacity: 0 }}
        className={`${STAMP} left-4 -rotate-6 border-k-ok text-k-ok`}
      >
        Good
      </span>
      <span
        ref={again}
        data-stamp="again"
        aria-hidden="true"
        style={{ opacity: 0 }}
        className={`${STAMP} right-4 rotate-6 border-k-danger text-k-danger`}
      >
        Again
      </span>
      {children}
    </div>
  );
}
