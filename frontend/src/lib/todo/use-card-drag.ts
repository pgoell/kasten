import { useEffect, useRef, useState } from "react";
import type { Column } from "@/lib/todo/todo-board";
import type { Spot } from "@/lib/todo/todo-drag";

/** How far, in pixels, a pressed pointer may wander and still be a click or a tap. */
const SLOP = 5;

/** How long a finger holds still on a card before it picks the card up. */
const LONG_PRESS_MS = 400;

/** A press on a card, which becomes a drag once the card is lifted. */
interface Press<C> {
  card: C;
  from: Spot;
  /** The pointer that pressed, so a second finger neither drops nor steers the card. */
  pointerId: number;
  x: number;
  y: number;
  touch: boolean;
  /** Past the slop for a mouse, past the long press for a finger. */
  lifted: boolean;
  /** The cell under the pointer, null over anything else. */
  over: Spot | null;
  timer?: ReturnType<typeof setTimeout>;
  /** Takes the window's listeners off again. */
  off: () => void;
}

/** What a board draws and asks of a drag in progress. */
export interface CardDrag<C> {
  /** The key of the card being carried, or null. */
  lifted: string | null;
  /** The drop zone under the pointer, or null. */
  overZone: string | null;
  grab(e: React.PointerEvent<HTMLElement>, card: C, from: Spot): void;
  hover(e: React.PointerEvent, zone: string, column: Column, lane?: string): void;
  unhover(e: React.PointerEvent): void;
  endDrag(): void;
  /** Whether a card is up, so Escape means to let it go. */
  carrying(): boolean;
  /** Whether the last drag ended over the card it lifted, read and cleared. */
  swallowed(): boolean;
}

/**
 * Pointer drag of a card between drop zones. `keyOf` names a card by the key
 * the board draws it under, and `land` gets the card, where it came from and
 * where it was let go.
 */
export function useCardDrag<C>(
  keyOf: (card: C) => string,
  land: (card: C, from: Spot, to: Spot) => void,
): CardDrag<C> {
  /**
   * The press under way. A ref, since the window's listeners read it between
   * renders; `lifted` and `overZone` draw the same thing.
   */
  const press = useRef<Press<C> | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  /** The drop zone under the pointer, by a name each zone draws itself against. */
  const [overZone, setOverZone] = useState<string | null>(null);
  /** A drag let go over the card it lifted still clicks it, which opens nothing. */
  const swallow = useRef(false);

  // A board taken away mid drag leaves no listener on the window.
  useEffect(
    () => () => {
      clearTimeout(press.current?.timer);
      press.current?.off();
    },
    [],
  );

  /** Escape, a cancelled pointer, a finger that scrolled, or the end of a drop. */
  function endDrag() {
    const held = press.current;
    if (held === null) return;
    clearTimeout(held.timer);
    held.off();
    press.current = null;
    setLifted(null);
    setOverZone(null);
  }

  /**
   * The pointer came over a drop zone; `lane` left out is the lane the card
   * left. Another finger passing over one moves nothing.
   */
  function hover(event: React.PointerEvent, zone: string, column: Column, lane?: string) {
    const held = press.current;
    if (!held?.lifted || event.pointerId !== held.pointerId) return;
    held.over = { lane: lane ?? held.from.lane, column };
    setOverZone(zone);
  }

  function unhover(event: React.PointerEvent) {
    const held = press.current;
    if (!held?.lifted || event.pointerId !== held.pointerId) return;
    held.over = null;
    setOverZone(null);
  }

  // The window's listeners outlive the render that added them, so they land
  // through this, which holds the lanes and the props of the latest one.
  const landing = useRef(land);
  landing.current = land;

  // Pointer events rather than HTML drag and drop, which a phone does not
  // fire for a finger. A mouse lifts the card once it moves past the slop, so
  // a click still opens it. A finger lifts it after a long press, and one that
  // moves first is a scroll the browser goes on with.
  function grab(event: React.PointerEvent<HTMLElement>, card: C, from: Spot) {
    swallow.current = false;
    if (event.button !== 0 || press.current !== null) return;
    const target = event.currentTarget;
    const { pointerId } = event;
    const touch = event.pointerType === "touch";
    const stop = (other: Event) => other.preventDefault();
    // A second finger's events are not this press's.
    const mine = (other: PointerEvent) => other.pointerId === pointerId;
    const cancel = (other: PointerEvent) => {
      if (mine(other)) endDrag();
    };
    // Before the lift a move is a scroll the browser goes on with; after it,
    // the finger carries the card and the page stays still.
    const carry = (other: Event) => {
      if (held.lifted) other.preventDefault();
    };

    const lift = () => {
      held.lifted = true;
      swallow.current = true;
      setLifted(keyOf(card));
      if (!touch) return;
      // A finger's pointer is held by the card it went down on, so no other
      // cell would hear it pass. Asked first, since letting go of a pointer
      // nothing holds throws; jsdom has no pointer capture at all.
      if ("hasPointerCapture" in target && target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      // From here the finger carries the card, which no menu interrupts.
      window.addEventListener("contextmenu", stop);
    };
    const move = (other: PointerEvent) => {
      if (!mine(other) || held.lifted) return;
      if (Math.hypot(other.clientX - held.x, other.clientY - held.y) <= SLOP) return;
      if (touch) endDrag();
      else lift();
    };
    const up = (other: PointerEvent) => {
      if (!mine(other)) return;
      const { lifted: carried, over } = held;
      endDrag();
      if (carried && over !== null) landing.current(held.card, held.from, over);
    };

    const held: Press<C> = {
      card,
      from,
      pointerId,
      x: event.clientX,
      y: event.clientY,
      touch,
      lifted: false,
      over: null,
      timer: touch ? setTimeout(lift, LONG_PRESS_MS) : undefined,
      off: () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("touchmove", carry);
        window.removeEventListener("contextmenu", stop);
      },
    };
    press.current = held;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    // Added at the press, not at the lift: Android Chrome may already treat a
    // touch's moves as uncancelable 400 ms in, once one went by unasked.
    if (touch) window.addEventListener("touchmove", carry, { passive: false });
  }

  return {
    lifted,
    overZone,
    grab,
    hover,
    unhover,
    endDrag,
    carrying: () => press.current?.lifted === true,
    swallowed: () => {
      const was = swallow.current;
      swallow.current = false;
      return was;
    },
  };
}
