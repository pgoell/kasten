import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { KindIcon, paneKind } from "@/components/kind-icons";
import { focusedOf, tabLabel } from "@/components/tab-label";
import type { HeldRow } from "@/lib/held-text";
import { activeTab, isEmptyTab, type Layout, panesOf, type Tab } from "@/lib/panes";
import { SPRINGS, Spring } from "@/lib/spring";
import { foldTabs } from "@/lib/tab-fold";
import type { SaveStatus } from "@/lib/use-autosave";

interface TabStripProps {
  layout: Layout;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
  onHome: () => void;
  /** Whether a tab has text that is not in the vault yet, which the dot says. */
  unsaved: (tab: Tab) => boolean;
}

/**
 * Whether a tab has text that is not in the vault yet.
 *
 * Two sources, both the app's own. Any pane on a note whose text is held counts,
 * because held text is what has not been written. The focused pane of the active
 * tab counts while the autosave says it is not saved, since the autosave follows
 * that pane alone.
 */
export function isUnsaved(
  tab: Tab,
  active: boolean,
  held: readonly Pick<HeldRow, "path">[],
  status: SaveStatus,
): boolean {
  const heldHere = panesOf(tab.root).some(
    (pane) => pane.path !== undefined && held.some((row) => row.path === pane.path),
  );
  return heldHere || (active && status !== "saved" && focusedOf(tab)?.path !== undefined);
}

/**
 * The key that goes to a tab, which is named on the tab rather than drawn on it.
 *
 * The tenth tab is `0`, the same key the digit used to show.
 */
function keyFor(index: number): string {
  return `Space ${(index + 1) % 10}`;
}

/**
 * The room the "N more" button keeps at the right of the tabs, in px.
 *
 * Kept in step with the button's own `w-[88px]`, so a tab is never drawn under it.
 */
const MORE = 88;

/**
 * Set once the strip has been drawn, so the entrance plays once per page.
 *
 * Module-level and not in state: the route can unmount and remount the strip,
 * and a remount in the same page is not a first load.
 */
let drawn = false;

/** Let the next mount play the entrance again. For tests, which share one page. */
export function resetStripEntrance(): void {
  drawn = false;
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * The strip naming the open tabs, under the top bar and always drawn.
 *
 * Today sits first as the home button, outside the numbered tabs, and then the
 * open tabs. Tabs that do not fit go behind "N more" at the right, and the active
 * tab is always drawn, so the strip never shows a tab the user cannot see.
 */
export function TabStrip({ layout, onSelect, onClose, onHome, unsaved }: TabStripProps) {
  const list = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const moreBox = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const { active } = layout;
  const count = layout.tabs.length;
  const home = isEmptyTab(activeTab(layout));

  // The entrance is decided on the first render and then kept, so a later
  // render of the same strip does not play it again.
  const [entering] = useState(() => !drawn);
  // A layout effect, so the class is already on when the browser first paints.
  useLayoutEffect(() => {
    drawn = true;
  }, []);

  // The bar's left edge and width are springs, so it glides from one tab to the
  // next. Painted as a transform, because left and width would lay the strip out
  // on every frame of the glide.
  const [motion] = useState(() => {
    const paint = () => {
      if (bar.current === null) return;
      bar.current.style.transform = `translateX(${motion.x.value}px) scaleX(${motion.width.value})`;
    };
    return { x: new Spring(0, paint), width: new Spring(0, paint) };
  });
  // Whether the bar has been drawn since it last appeared, so its first place is
  // a jump and not a glide in from the left edge.
  const placed = useRef(false);

  // Which tabs are behind "N more". Measured in the layout effect below, so the
  // first paint already has the right set.
  const [hidden, setHidden] = useState<readonly number[]>([]);
  const [cap, setCap] = useState<number>();

  // The labels too: a label that grows, or a web font that arrives, widens a tab
  // without changing the count, and the fold has to follow it.
  const labels = layout.tabs.map(tabLabel).join("\n");

  // The fold follows the width of the tabs and of the row they sit in. Measured
  // here, before paint, so a tab switch never shows a strip that has not folded.
  // A tab that is folded keeps its width, being hidden rather than removed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all three are the trigger, and count and labels are not read.
  useLayoutEffect(() => {
    const row = list.current;
    if (row === null) return;
    const measure = () => {
      const tabs = [...row.querySelectorAll<HTMLElement>("[data-tab]")];
      const widths = tabs.map((tab) => tab.offsetWidth);
      // No room at all is a strip not laid out (hidden, or no layout as in
      // jsdom), where folding would hide every tab but the active one for nothing.
      const next =
        row.clientWidth === 0 ? [] : foldTabs(widths, row.clientWidth, active, MORE).hidden;
      setHidden((previous) => (same(previous, next) ? previous : next));
      // The room a tab shown beside the button may take, so a folded-in active tab
      // is cut by its own ellipsis rather than running under the button.
      setCap(row.clientWidth - MORE);
      // With nothing folded there is no list to open, and one that was open must
      // not come back by itself when the window narrows again.
      if (next.length === 0) setOpen(false);
    };
    measure();
    // jsdom has no observer, where every width is 0 and every tab is drawn.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const tab of row.querySelectorAll<HTMLElement>("[data-tab]")) observer.observe(tab);
    return () => observer.disconnect();
  }, [active, count, labels]);

  // The bar follows the active tab once the fold has been applied, so it is
  // placed after the render that folds, and not in the effect above where the
  // tabs before the active one could still be in the old places.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all four are the trigger, and none of them is read.
  useLayoutEffect(() => {
    const row = list.current;
    const tab = row?.querySelectorAll<HTMLElement>("[data-tab]")[active];
    if (row === null || row === undefined || tab === undefined) {
      placed.current = false;
      return;
    }
    const place = () => {
      if (placed.current) {
        void motion.x.to(tab.offsetLeft, SPRINGS.tab);
        void motion.width.to(tab.offsetWidth, SPRINGS.tab);
      } else {
        motion.x.set(tab.offsetLeft);
        motion.width.set(tab.offsetWidth);
      }
      placed.current = true;
    };
    place();
    // A tab that changes width moves the bar's far edge, and a font changes
    // every tab at once, so each tab is watched.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    for (const element of row.querySelectorAll<HTMLElement>("[data-tab]")) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [active, count, labels, hidden]);

  const [open, setOpen] = useState(false);
  const menuOpen = open && hidden.length > 0;

  // Opening the list puts the focus on its first row, which is where the keys go.
  useEffect(() => {
    if (menuOpen) moreBox.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuOpen]);

  // A click anywhere else closes the list. A click on the button itself is
  // inside the box, so it is left to the button's own toggle.
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !moreBox.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);

  // Arrow keys walk the rows, and Escape closes the list and gives the focus
  // back to the button that opened it.
  const onMoreKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      moreButton.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...(moreBox.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (rows.length === 0) return;
    event.preventDefault();
    const at = event.target instanceof HTMLElement ? rows.indexOf(event.target) : -1;
    const down = event.key === "ArrowDown";
    const next =
      at === -1 ? (down ? 0 : rows.length - 1) : (at + (down ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus();
  };

  // The tablist is one tab stop: the active tab holds it, and the arrows walk
  // the tabs on screen, as the ARIA tabs pattern has it. Enter and Space select
  // through the native button; Delete closes the tab it is on.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = event.target instanceof HTMLElement ? event.target.closest("[data-tab]") : null;
    if (!(from instanceof HTMLElement)) return;
    const index = Number(from.dataset.tab);
    if (event.key === "Delete") {
      onClose(index);
      return;
    }
    const shown = layout.tabs.map((_, at) => at).filter((at) => !hidden.includes(at));
    const at = shown.indexOf(index);
    let to: number | undefined;
    if (event.key === "ArrowRight") to = shown[(at + 1) % shown.length];
    else if (event.key === "ArrowLeft") to = shown[(at - 1 + shown.length) % shown.length];
    else if (event.key === "Home") to = shown[0];
    else if (event.key === "End") to = shown.at(-1);
    else return;
    event.preventDefault();
    if (to === undefined) return;
    list.current?.querySelector<HTMLElement>(`[data-tab="${to}"] [role="tab"]`)?.focus();
  };

  return (
    <div
      className={`k-glass k-hairline sticky top-0 z-20 flex h-10 shrink-0 items-stretch font-sans text-k-13 pointer-coarse:h-11 ${
        entering ? "k-enter" : ""
      }`}
    >
      <button
        type="button"
        onClick={onHome}
        className={`shrink-0 px-3 font-serif text-k-15 italic hover:bg-k-accent-wash ${
          home ? "text-k-ink" : "text-k-muted"
        }`}
      >
        Today
      </button>
      <span aria-hidden="true" className="my-2.5 w-px shrink-0 bg-k-rule" />
      <div
        ref={list}
        role="tablist"
        aria-label="Open tabs"
        onKeyDown={onTabKey}
        // Hidden tabs stay in the row, out of view, so their widths can be
        // measured. The clip stops them from widening the page sideways.
        className="relative flex min-w-0 flex-1 items-stretch overflow-hidden"
      >
        {layout.tabs.map((tab, index) => {
          const selected = index === active;
          const folded = hidden.includes(index);
          const focused = focusedOf(tab);
          const title = tabLabel(tab);
          const dirty = unsaved(tab);
          return (
            <div
              key={tab.id}
              data-tab={index}
              inert={folded}
              aria-hidden={folded || undefined}
              // Not allowed to shrink: a flex item that does would squeeze every
              // tab to the room, so nothing would ever be measured wider than it fits.
              // The cap is on the whole tab, close x included. Its wash is on the tab,
              // so the x is washed with it.
              className={`group flex shrink-0 items-stretch max-w-[200px] pr-2 ${
                selected ? "" : "hover:bg-k-accent-wash"
              } ${folded ? "invisible pointer-events-none absolute" : ""}`}
              style={
                hidden.length > 0 && selected && cap !== undefined
                  ? { maxWidth: Math.min(200, cap) }
                  : undefined
              }
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                aria-keyshortcuts={keyFor(index)}
                title={keyFor(index)}
                onClick={() => onSelect(index)}
                className={`flex min-w-0 items-center gap-1.5 px-3 whitespace-nowrap ${
                  selected ? "text-k-ink" : "text-k-muted"
                }`}
              >
                {focused !== undefined && <KindIcon kind={paneKind(focused)} />}
                <span className="min-w-0 truncate">{title}</span>
                {dirty && (
                  <>
                    {" "}
                    <span className="sr-only">(unsaved)</span>
                  </>
                )}
              </button>
              {/* The close x is a sibling of the tab, not a button inside it, so a
                  click on it closes this tab and selects nothing first. The dot
                  sits in the same room, so an unsaved mark moves nothing. */}
              {/* Under a finger the slot is 44 px wide and the strip's height, and the
                  x fills it, so the target is the size of a finger. The active tab's x
                  shows under a finger even when unsaved, since hover never comes. */}
              <span className="relative size-4 shrink-0 self-center pointer-coarse:h-auto pointer-coarse:w-11 pointer-coarse:self-stretch">
                {dirty && (
                  <span
                    aria-hidden="true"
                    className={`absolute top-1/2 left-1/2 size-2 -translate-1/2 rounded-full bg-k-muted group-hover:hidden ${
                      selected ? "pointer-coarse:hidden" : ""
                    }`}
                  />
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Close ${title}`}
                  onClick={() => onClose(index)}
                  className={`flex size-4 items-center justify-center text-k-muted hover:text-k-ink pointer-coarse:size-full ${
                    selected ? "pointer-coarse:visible" : ""
                  } ${selected && !dirty ? "" : "invisible group-hover:visible"}`}
                >
                  <svg
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                    className="size-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </button>
              </span>
            </div>
          );
        })}
        {/* The bar is inside the tablist, which is positioned, so its offsets
            are the tab's own. */}
        <span
          ref={bar}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-px origin-left bg-k-accent"
        />
      </div>
      {hidden.length > 0 && (
        <div ref={moreBox} className="absolute inset-y-0 right-0 flex w-[88px] items-stretch">
          <button
            ref={moreButton}
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setOpen((previous) => !previous)}
            onKeyDown={onMoreKey}
            className="flex-1 px-3 text-k-muted hover:bg-k-accent-wash"
          >
            {`${hidden.length} more`}
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="Tabs behind more"
              onKeyDown={onMoreKey}
              className="absolute top-full right-2 z-20 mt-1 flex min-w-56 flex-col border border-k-rule bg-k-paper py-1 shadow-[var(--k-shadow)]"
            >
              {layout.tabs.map((tab, index) => {
                if (!hidden.includes(index)) return null;
                const focused = focusedOf(tab);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="menuitem"
                    className="k-row flex min-w-0 items-center gap-2 px-3 py-1.5 text-left text-k-ink outline-none hover:bg-k-accent-wash focus-visible:bg-k-accent-wash"
                    onClick={() => {
                      onSelect(index);
                      setOpen(false);
                      moreButton.current?.focus();
                    }}
                  >
                    {focused !== undefined && <KindIcon kind={paneKind(focused)} />}
                    <span className="min-w-0 truncate">{tabLabel(tab)}</span>
                    {unsaved(tab) && (
                      <>
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full bg-k-muted"
                        />{" "}
                        <span className="sr-only">(unsaved)</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
