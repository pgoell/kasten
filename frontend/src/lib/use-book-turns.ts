import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";
import type { FoliateView } from "@/lib/foliate-view";

/**
 * How much of the pane's width, at each side, a tap turns the page from.
 *
 * A quarter leaves the middle half for what a tap in the text already means:
 * putting a selection away, or nothing.
 */
const EDGE = 0.25;

/**
 * How far `j` and `k` move a flowing book, in pixels.
 *
 * The 19 px text at 1.6 leading is about 30 px a line, so three lines is 91. A
 * screen would lose the line the reader was on, and one line is too slow to read by.
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
   * The turn `h`, `l` or a tap near an edge asked for before the book was
   * ready, made once it is.
   *
   * `init` opens a book with no bookmark through the paginator's own `next()`,
   * which holds its turn lock for 100ms after the first page has drawn
   * (`paginator.js:1060-1071`), and a turn asked for under that lock returns
   * having done nothing and said nothing (#370, #372). One and not a queue: the
   * same lock is what keeps a held key from turning a page per repeat. A tap
   * parks its side and not a direction, for the reason `tap` turns by side.
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
   * `j` and `k`. A flowing book scrolls by `SCROLL_STEP` on its renderer, and a
   * pdf or a pre-paginated epub turns its page, as `h` and `l` do there.
   *
   * A parked scroll stays a scroll, so it lands as one step on a flowing book
   * and not as a page: `release` decides by the book, as this does.
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
   * Turn the page for a tap near either edge, on a touch screen alone.
   *
   * A swipe already turns a flowing book, the paginator following the finger
   * and snapping to a page (`paginator.js:568-574, :831-865`). The renderer a
   * pdf and a pre-paginated epub get listens for no touch at all
   * (`fixed-layout.js`), so there this is the only way to turn one.
   *
   * By side and not by the `prev` and `next` that `h` and `l` call: the
   * swipe follows the finger, so in a book read right to left the left edge
   * is the way forward, and `goLeft` and `goRight` ask the book which it is
   * (`view.js:519-524`).
   *
   * `click` and not `pointerdown`: a swipe and a long press end in no click,
   * so neither turns a page on its way to doing something else.
   *
   * Measured against the pane and not the document. The paginator widens its
   * iframe to the whole columnised chapter, so the document's own width says
   * nothing about where on the page a tap fell. The ratio undoes the css
   * scale a pre-paginated epub's frame carries (`fixed-layout.js:143`), which
   * the event's coordinates are inside of; it is 1 everywhere else.
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
