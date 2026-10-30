import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";
import type { FoliateView } from "@/lib/book/foliate-view";

/**
 * How much of the pane's width, at each side, a tap turns the page from. A quarter leaves the middle
 * half for what a tap in the text already means: putting a selection away, or nothing.
 */
const EDGE = 0.25;

/**
 * How far `j` and `k` move a flowing book, in pixels. Three lines of 19px text at 1.6 leading is 91px:
 * one line is too slow to read by, and more would lose the line the reader was on.
 */
const SCROLL_STEP = 91;

/** A key or tap asked for before the book was ready, kept until it is: a page turn by side, or a scroll step. */
type Parked =
  | { kind: "turn"; side: "next" | "prev" | "goLeft" | "goRight" }
  | { kind: "scroll"; direction: "next" | "prev" };

/** One step forward or back: a scroll step on a flowing book, a page on a fixed layout. */
function stepOf(view: FoliateView, direction: "next" | "prev"): void {
  if (view.isFixedLayout) view[direction]();
  else view.renderer?.[direction](SCROLL_STEP);
}

/** What the turn hook hands the pane: the ways a page turns, and the ends of a turn parked before the book was ready. */
export interface BookTurns {
  /** Turn one page, or park the turn until the book is ready. */
  turn(direction: "next" | "prev"): void;
  /** Move a flowing book down or up a few lines, or turn a fixed-layout page. Parked like `turn`. */
  scroll(direction: "down" | "up"): void;
  /** A click on the book, which turns the page when it lands near an edge on a touch screen. */
  tap(event: MouseEvent): void;
  /** Once the book is ready: make the turn that was parked while it opened, unless a passage took its place. */
  release(view: FoliateView, seekParked: boolean): void;
  /** Drop a parked turn for a book that is going away. */
  forget(): void;
}

/**
 * Page turns, from the keys and from a tap, held until the book can take them.
 */
export function useBookTurns(o: {
  wrapper: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<FoliateView | null>;
  ready: RefObject<boolean>;
  coarse: boolean;
  holding: () => boolean;
}): BookTurns {
  const { wrapper, viewRef, ready, coarse, holding } = o;
  /**
   * The turn `h`, `l` or an edge tap asked for before the book was ready, made once it is. `init` holds
   * the paginator's turn lock for 100ms, so a turn asked under it is lost (#370, #372). One turn, not a queue: the lock also stops a held key.
   */
  const parkedTurn = useRef<Parked | null>(null);
  // Read through a ref so `tap` keeps one identity for the life of the pane.
  const coarseRef = useRef(coarse);
  useLayoutEffect(() => {
    coarseRef.current = coarse;
  });

  const turn = useCallback(
    (direction: "next" | "prev") => {
      if (ready.current) viewRef.current?.[direction]();
      else parkedTurn.current = { kind: "turn", side: direction };
    },
    [ready, viewRef],
  );

  /**
   * `j` and `k`. A flowing book scrolls by `SCROLL_STEP`; a pdf or pre-paginated epub turns its page instead.
   * A parked scroll stays a scroll, so `release` decides by the book, as this does.
   */
  const scroll = useCallback(
    (direction: "down" | "up") => {
      const side = direction === "down" ? "next" : "prev";
      if (!ready.current) {
        parkedTurn.current = { kind: "scroll", direction: side };
        return;
      }
      const view = viewRef.current;
      if (view === null) return;
      stepOf(view, side);
    },
    [ready, viewRef],
  );

  /**
   * Turn the page for a tap near either edge, on a touch screen alone. Only a pdf and a pre-paginated epub
   * need it, since a flowing book swipes. Taps are by side, not `prev` and `next`, as `goLeft` and `goRight` ask the book which way is forward.
   */
  const tap = useCallback(
    (event: MouseEvent) => {
      if (!coarseRef.current || event.defaultPrevented) return;
      // A tap with words held belongs to the selection, and one on a link to
      // the link.
      if (holding() || (event.target as Element).closest("a[href]")) return;

      const frame = (event.currentTarget as Document).defaultView?.frameElement;
      const pane = wrapper.current;
      if (!(frame instanceof HTMLElement) || pane === null) return;

      const outer = frame.getBoundingClientRect();
      const box = pane.getBoundingClientRect();
      const x = outer.left + (event.clientX * outer.width) / frame.offsetWidth - box.left;
      const side = x < box.width * EDGE ? "goLeft" : x > box.width * (1 - EDGE) ? "goRight" : null;
      if (side === null) return;
      if (ready.current) void viewRef.current?.[side]();
      else parkedTurn.current = { kind: "turn", side };
    },
    [holding, ready, viewRef, wrapper],
  );

  const release = useCallback((view: FoliateView, seekParked: boolean) => {
    // `init` has let go of the lock by now, its `next()` having waited the
    // 100ms out. A parked passage wins over a parked turn: it is where the
    // reader asked to be taken, and the turn's lock would drop its `goTo`.
    const parked = parkedTurn.current;
    parkedTurn.current = null;
    if (parked === null || seekParked) return;
    if (parked.kind === "scroll") stepOf(view, parked.direction);
    else void view[parked.side]();
  }, []);

  const forget = useCallback(() => {
    parkedTurn.current = null;
  }, []);

  return { turn, scroll, tap, release, forget };
}
