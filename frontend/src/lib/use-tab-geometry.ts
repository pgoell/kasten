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
 * The widest a tab draws, in px. Tailwind needs literal classes, so the 200s in tab-strip.tsx
 * are kept in step by hand.
 */
export const TAB_MAX_WIDTH = 200;

/** Room kept at the right for the "N more" button, in px. Matches its `w-[88px]`. */
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
 * The fold of a tab strip and the placement of its bar under the active tab. One ResizeObserver
 * stores the widths, so switching tabs reads no geometry. `motion` is the bar's springs.
 */
export function useTabGeometry(
  list: RefObject<HTMLDivElement | null>,
  motion: { x: Spring; width: Spring },
  active: number,
  tabIds: string,
  labels: string,
  fold: boolean,
): TabGeometry {
  // Until the bar is drawn, its first place is a jump, not a glide in from the left.
  const placed = useRef(false);
  const [hidden, setHidden] = useState<readonly number[]>([]);
  const [cap, setCap] = useState<number>();
  const [open, setOpen] = useState(false);
  // A ref, since the observer's callback would otherwise keep the value it was made with.
  const folding = useRef(fold);
  folding.current = fold;

  // Each tab's natural width, keyed by element so it follows the tab, not its index.
  const [natural] = useState(() => new WeakMap<HTMLElement, number>());
  const room = useRef(0);
  // Set by the observer's first callback. Until then the layout effect measures the DOM itself,
  // since jsdom's observer never reports.
  const reported = useRef(false);
  // The live observer, so the fold can observe the active tab again on its own.
  const observerRef = useRef<ResizeObserver | null>(null);
  // The observer outlives renders, so it reads the active tab from here.
  const activeNow = useRef(active);

  // A tab read at a cap the fold gave it would shape that fold, so it is re-read without the cap.
  // The class's own cap is not the fold's, so a tab under TAB_MAX_WIDTH is read as it is.
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
    // No room means no layout (hidden, or jsdom): folding then would hide tabs for nothing.
    if (room.current === 0 || !folding.current) return [];
    return foldTabs(sizes, room.current, at, MORE).hidden;
  };

  const apply = (next: readonly number[]) => {
    setHidden((previous) => (same(previous, next) ? previous : next));
    // Room for the active tab beside the button, so it ellipsises rather than running under it.
    setCap(Math.max(0, room.current - MORE));
    // No folded tabs, no list: an open one must not reappear on its own when narrowing again.
    if (next.length === 0) setOpen(false);
  };

  // The bar under the active tab: from the stored widths once reported, else the tab's offsets.
  // Folded tabs are absolute, so they are left out of the bar's x.
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
      // A new element reports only once it has a size, so the bar waits for that report.
      if (size === undefined) return undefined;
      sizes.push(size);
    }
    const own = sizes[at];
    if (own === undefined) return undefined;
    // Folded tabs are absolute, so they take no room.
    const x = sizes
      .slice(0, at)
      .reduce((sum, size, index) => sum + (folded.includes(index) ? 0 : size), 0);
    // The cap is on the tab's box, so the bar is no wider than the box.
    const limit = Number.parseFloat(tab.style.maxWidth);
    return { x, width: Number.isNaN(limit) ? own : Math.min(own, limit) };
  };

  // Set before paint so a tab switch never shows an unfolded strip; folded tabs keep their width.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all four are the trigger, and tabIds and labels are not read.
  useLayoutEffect(() => {
    const row = list.current;
    if (row === null) return;
    activeNow.current = active;
    if (!reported.current) measure(row);
    apply(foldOf(row, active));
    // A capped tab's box ignores a grown label, so re-observe every element to make each report.
    // No unobserve: test stubs lack it.
    const observer = observerRef.current;
    if (observer !== null) {
      observer.disconnect();
      observer.observe(row);
      for (const element of row.querySelectorAll<HTMLElement>("[data-tab]")) {
        observer.observe(element);
      }
    }
  }, [active, tabIds, labels, fold]);

  // Placed after the render that folds, not in the effect above, which would see old tab positions.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all four are the trigger, and none of them is read.
  useLayoutEffect(() => {
    const row = list.current;
    if (row === null) {
      placed.current = false;
      return;
    }
    place(row, active, hidden);
  }, [active, tabIds, labels, hidden]);

  // One observer for the fold and the bar, remade when the tabs change. Its callback runs
  // before paint, so a fold it sets lands in the frame being drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: made again per set of tabs, and what it calls reads only refs and state setters.
  useLayoutEffect(() => {
    const row = list.current;
    // jsdom has no observer, where the layout effects above keep the fold.
    if (row === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      reported.current = true;
      measure(row);
      const next = foldOf(row, activeNow.current);
      // A state set outside React waits for a task, after the paint, so flush it here.
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
