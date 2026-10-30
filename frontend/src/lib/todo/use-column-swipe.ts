/**
 * A phone board's column that a finger swipes to the next or previous state, modelled on the flashcard swipe in `review-swipe.tsx`.
 * Only the column moves, so the tabs and the page keep their own touches.
 */

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { axis, type Sample, speed } from "@/lib/sheet-math";
import { afterRelease, SPRINGS, Spring } from "@/lib/spring";
import { swipeOffset, swipeTarget } from "@/lib/todo/column-swipe";

/**
 * A touch this close to the window's left or right edge belongs to the system,
 * which uses the edge for its own back gesture.
 */
const EDGE = 16;

interface Gesture {
  pointer: number;
  x: number;
  y: number;
  /** The offset the column had when the finger went down, so a press mid-spring picks up there. */
  start: number;
  /** Set once the drag is sideways and allowed: the column follows the finger. */
  decided: boolean;
  /** Set when the gesture is over for swiping: a vertical drag, a card lifted, or a second finger. */
  dead: boolean;
  width: number;
  samples: Sample[];
}

interface SwipeOptions {
  /** Whether the column is drawn at all, which on a desktop it is not. */
  active: boolean;
  /** The shown column and how many there are. */
  index: number;
  count: number;
  /** True while a card is lifted, which takes the finger away from the column. */
  carrying: () => boolean;
  /** Shows the column at `index`, as a tab tap does. */
  onShow: (index: number) => void;
}

/** The ref and pointer handlers a column is drawn with. */
export interface ColumnSwipe {
  ref: RefObject<HTMLDivElement | null>;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  };
}

export function useColumnSwipe({
  active,
  index,
  count,
  carrying,
  onShow,
}: SwipeOptions): ColumnSwipe {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  // Set by a swipe, so the click a release may send is not a tap on a card in
  // the column. Cleared by that click and by the next press, so a later tap is
  // never eaten.
  const swallow = useRef(false);
  // Read on each event, so the latest render's column is the one a release shows.
  const latest = useRef({ index, count, carrying, onShow });
  latest.current = { index, count, carrying, onShow };

  const paint = (offset: number) => {
    if (ref.current) ref.current.style.transform = `translateX(${offset}px)`;
  };
  const [spring] = useState(() => new Spring(0, paint));

  useEffect(() => () => spring.stop(), [spring]);

  // React attaches touchmove as passive, and a passive listener cannot stop the
  // page from panning sideways. Native and non-passive, it can, once decided.
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const move = (event: TouchEvent) => {
      if (gesture.current?.decided) event.preventDefault();
    };
    el.addEventListener("touchmove", move, { passive: false });
    return () => el.removeEventListener("touchmove", move);
  }, [active]);

  // A swipe that is over for stepping: the column springs back to rest, and the
  // click the finger may still send is swallowed. Undecided, there is nothing to undo.
  function kill(held: Gesture) {
    held.dead = true;
    if (held.decided) {
      swallow.current = true;
      void spring.to(0, SPRINGS.sheetClose);
    }
  }

  // The gesture ends without a step: a cancel, or the pointer taken from the column.
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
    if (event.pointerType !== "touch") return;
    const held = gesture.current;
    if (held) {
      // A second finger ends the first one's swipe, and nothing is shown.
      if (!held.dead) kill(held);
      return;
    }
    swallow.current = false;
    spring.stop();
    const edge = event.clientX < EDGE || event.clientX > window.innerWidth - EDGE;
    gesture.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: spring.value,
      decided: false,
      dead: edge || latest.current.carrying(),
      width: 0,
      samples: [{ t: performance.now(), y: event.clientX }],
    };
  }

  /** Decides the axis once SLOP is passed. True when the drag is sideways and so is the swipe's. */
  function decide(held: Gesture, pointerId: number, dx: number, dy: number): boolean {
    // axis() calls a vertical win "scroll", so the arguments are swapped to make its "drag" the sideways one.
    const verdict = axis(dy, dx);
    if (verdict === "pending") return false;
    // Vertical is the page's. The rest of this gesture is left to scrolling.
    if (verdict === "scroll") {
      held.dead = true;
      return false;
    }
    held.decided = true;
    // Asked first, since jsdom has no pointer capture at all.
    if (ref.current && "setPointerCapture" in ref.current) {
      ref.current.setPointerCapture(pointerId);
    }
    held.width = ref.current?.getBoundingClientRect().width ?? 0;
    return true;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const held = gesture.current;
    if (!held || held.dead || event.pointerId !== held.pointer) return;
    // A card lifted under the finger: the card carries it, and the column stays.
    if (latest.current.carrying()) {
      kill(held);
      return;
    }
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    if (!held.decided && !decide(held, event.pointerId, dx, dy)) return;
    held.samples.push({ t: performance.now(), y: event.clientX });
    const { index: shown, count: total } = latest.current;
    spring.set(swipeOffset(held.start + dx, held.width, shown, total));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const held = gesture.current;
    if (!held || held.pointer !== event.pointerId) return;
    gesture.current = null;
    if (held.dead || !held.decided) return;

    swallow.current = true;
    const v = speed(held.samples, performance.now());
    const { index: shown, count: total } = latest.current;
    const step = swipeTarget(spring.value, v, held.width, shown, total);
    if (step === 0) {
      void spring.to(0, afterRelease(SPRINGS.sheetClose, v), v);
      return;
    }
    // The new column comes in from the side the finger went, so it starts off
    // that side of its rest and springs to it.
    latest.current.onShow(shown + step);
    spring.set(step * held.width);
    void spring.to(0, afterRelease(SPRINGS.tab, v));
  }

  return {
    ref,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: (event) => abandon(event.pointerId),
      // A card's button holds the finger first, so the column's capture takes it
      // from the card, and the card's loss bubbles here. Only the column's own loss
      // is the swipe's end: the card's is the hand-off, not a cancel.
      onLostPointerCapture: (event) => {
        if (event.target === ref.current) abandon(event.pointerId);
      },
      // Capture, so the click a swipe ends with stops here and opens no card.
      onClickCapture: (event) => {
        if (!swallow.current) return;
        // One click only: a release sends at most one, and a later tap must not be eaten.
        swallow.current = false;
        event.stopPropagation();
        event.preventDefault();
      },
    },
  };
}
