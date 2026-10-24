import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { SPRINGS, type Spring } from "@/lib/spring";
import { foldTabs } from "@/lib/tab-fold";

/**
 * The widest a tab draws, in px: the `max-w-[200px]` class on the tab in tab-strip.tsx.
 *
 * Tailwind needs that class as a literal, so the two are kept in step by hand.
 */
export const TAB_MAX_WIDTH = 200;

/**
 * The room the "N more" button keeps at the right of the tabs, in px.
 *
 * Kept in step with the button's own `w-[88px]`, so a tab is never drawn under it.
 */
const MORE = 88;

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export interface TabGeometry {
  /** The indices of the tabs behind "N more". */
  hidden: readonly number[];
  /** The cap on the active tab while some are folded, in px. */
  cap: number | undefined;
  /** Whether the "N more" list is open. */
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * The fold of a tab strip and the placement of its bar under the active tab.
 *
 * One ResizeObserver measures the row and every tab, so a switch of the active
 * tab reads no geometry: the fold and the bar are worked out from the widths the
 * observer stored. `motion` is the bar's springs, placed here and painted by the
 * strip.
 */
export function useTabGeometry(
  list: RefObject<HTMLDivElement | null>,
  motion: { x: Spring; width: Spring },
  active: number,
  tabIds: string,
  labels: string,
): TabGeometry {
  // Whether the bar has been drawn since it last appeared, so its first place is
  // a jump and not a glide in from the left edge.
  const placed = useRef(false);
  const [hidden, setHidden] = useState<readonly number[]>([]);
  const [cap, setCap] = useState<number>();
  const [open, setOpen] = useState(false);

  // What the observer measured, written only by its callback. Each tab's natural
  // width is kept by element, so it follows the tab and not its index.
  const [natural] = useState(() => new WeakMap<HTMLElement, number>());
  const room = useRef(0);
  // Set by the observer's first callback. Until then the fold's layout effect measures
  // the DOM itself on every change: that is the first layout, and jsdom's observer never reports.
  const reported = useRef(false);
  // The live observer, so the fold can observe the active tab again on its own.
  const observerRef = useRef<ResizeObserver | null>(null);
  // The observer is made again when the tabs change, so it reads the active tab from here.
  const activeNow = useRef(active);

  // Reads the row and its tabs into the refs. A tab whose width reaches a cap the fold
  // gave it is read again without the cap, or the cap would shape the fold that set it
  // (R18), and a tab that was narrower before it became active (R6) or whose label grew
  // (R5) would keep its old width. The class's own cap is not the fold's: no tab is wider
  // than it, so a tab at that width is read as it is, without a lift.
  const measure = (row: HTMLElement) => {
    room.current = row.clientWidth;
    for (const tab of row.querySelectorAll<HTMLElement>("[data-tab]")) {
      const width = tab.offsetWidth;
      const limit = Number.parseFloat(tab.style.maxWidth);
      if (Number.isNaN(limit) || limit >= TAB_MAX_WIDTH || width < limit) {
        natural.set(tab, width);
      } else {
        const kept = tab.style.maxWidth;
        tab.style.maxWidth = "";
        natural.set(tab, tab.offsetWidth);
        tab.style.maxWidth = kept;
      }
    }
  };

  // The tabs behind "N more" for the widths in hand. Reads no geometry.
  const foldOf = (row: HTMLElement, at: number): readonly number[] => {
    const sizes = [...row.querySelectorAll<HTMLElement>("[data-tab]")].map(
      (tab) => natural.get(tab) ?? 0,
    );
    // No room at all is a strip not laid out (hidden, or no layout as in
    // jsdom), where folding would hide every tab but the active one for nothing.
    return room.current === 0 ? [] : foldTabs(sizes, room.current, at, MORE).hidden;
  };

  const apply = (next: readonly number[]) => {
    setHidden((previous) => (same(previous, next) ? previous : next));
    // The room a tab shown beside the button may take, so a folded-in active tab
    // is cut by its own ellipsis rather than running under the button.
    setCap(Math.max(0, room.current - MORE));
    // With nothing folded there is no list to open, and one that was open must
    // not come back by itself when the window narrows again.
    if (next.length === 0) setOpen(false);
  };

  // The bar under the active tab. Once the observer has reported it is placed from
  // the stored widths, and before that from the tab's own offsets. A folded tab is
  // absolute, so it takes no room in the row and is left out of the bar's left edge.
  const place = (row: HTMLElement, at: number, folded: readonly number[]) => {
    const tabs = [...row.querySelectorAll<HTMLElement>("[data-tab]")];
    const tab = tabs[at];
    if (tab === undefined) {
      placed.current = false;
      return;
    }
    const spot = reported.current
      ? fromStored(tab, tabs, at, folded)
      : { x: tab.offsetLeft, width: tab.offsetWidth };
    if (spot === undefined) return;
    if (placed.current) {
      void motion.x.to(spot.x, SPRINGS.tab);
      void motion.width.to(spot.width, SPRINGS.tab);
    } else {
      motion.x.set(spot.x);
      motion.width.set(spot.width);
    }
    placed.current = true;
  };

  // The bar's place from the stored widths, or nothing while a tab is still unreported.
  const fromStored = (
    tab: HTMLElement,
    tabs: HTMLElement[],
    at: number,
    folded: readonly number[],
  ) => {
    const sizes: number[] = [];
    for (const element of tabs) {
      const size = natural.get(element);
      // A newly observed element gets its first report once it has a size, so a 0 by 0
      // element may get none. The bar waits for that report.
      if (size === undefined) return undefined;
      sizes.push(size);
    }
    const own = sizes[at];
    if (own === undefined) return undefined;
    // A folded tab is absolute, so it takes no room in the row and is left out.
    const x = sizes
      .slice(0, at)
      .reduce((sum, size, index) => sum + (folded.includes(index) ? 0 : size), 0);
    // The cap is on the tab's box, so the bar is no wider than the box.
    const limit = Number.parseFloat(tab.style.maxWidth);
    return { x, width: Number.isNaN(limit) ? own : Math.min(own, limit) };
  };

  // The fold follows the width of the tabs and of the row they sit in. It is set
  // here, before paint, so a tab switch never shows a strip that has not folded.
  // A tab that is folded keeps its width, being hidden rather than removed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all three are the trigger, and tabIds and labels are not read.
  useLayoutEffect(() => {
    const row = list.current;
    if (row === null) return;
    activeNow.current = active;
    if (!reported.current) measure(row);
    apply(foldOf(row, active));
    // A capped tab's box does not change when its label grows, so the observer would
    // not hear of it. Observing the active tab again makes it report at once.
    const tab = row.querySelectorAll<HTMLElement>("[data-tab]")[active];
    if (tab !== undefined && observerRef.current !== null) {
      observerRef.current.unobserve(tab);
      observerRef.current.observe(tab);
    }
  }, [active, tabIds, labels]);

  // The bar follows the active tab once the fold has been applied, so it is
  // placed after the render that folds, and not in the effect above where the
  // tabs before the active one could still be in the old places.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all four are the trigger, and none of them is read.
  useLayoutEffect(() => {
    const row = list.current;
    if (row === null) {
      placed.current = false;
      return;
    }
    place(row, active, hidden);
  }, [active, tabIds, labels, hidden]);

  // One observer serves the fold and the bar. It watches the row and every tab, and
  // is made again when the set of tabs changes, since a new tab is a new element.
  // Its callback runs after layout and before paint, so a fold it sets lands in the
  // frame being drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: made again per set of tabs, and what it calls reads only refs and state setters.
  useLayoutEffect(() => {
    const row = list.current;
    // jsdom has no observer, where the layout effects above keep the fold.
    if (row === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      reported.current = true;
      measure(row);
      const next = foldOf(row, activeNow.current);
      // A state set outside React waits for a task, which runs after the paint, so
      // the fold is flushed here to reach this frame.
      flushSync(() => apply(next));
      place(row, activeNow.current, next);
    });
    observerRef.current = observer;
    observer.observe(row);
    for (const tab of row.querySelectorAll<HTMLElement>("[data-tab]")) observer.observe(tab);
    return () => {
      observerRef.current = null;
      observer.disconnect();
    };
  }, [tabIds]);

  return { hidden, cap, open, setOpen };
}
