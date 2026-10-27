import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { KindIcon, paneKind } from "@/components/kind-icons";
import { focusedOf, tabLabel } from "@/components/tab-label";
import type { HeldRow } from "@/lib/held-text";
import type { SaveStatus } from "@/lib/note/use-autosave";
import { activeTab, isEmptyTab, type Layout, panesOf, type Tab } from "@/lib/panes";
import { Spring } from "@/lib/spring";
import { TAB_MAX_WIDTH, useTabGeometry } from "@/lib/use-tab-geometry";
import { useViewport } from "@/lib/use-viewport";

interface TabStripProps {
  layout: Layout;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
  onHome: () => void;
  /** Whether a tab has text that is not in the vault yet, which the dot says. */
  unsaved: (tab: Tab) => boolean;
  /**
   * A window under 768 px. With a finger too, every tab is drawn and the row scrolls
   * sideways; with a mouse the tabs that do not fit fold behind "N more", as in a
   * wide window, since a wheel does not scroll the row sideways.
   */
  narrow?: boolean;
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

/**
 * The strip naming the open tabs, under the top bar and always drawn.
 *
 * Today sits first as the home button, outside the numbered tabs, and then the
 * open tabs. Tabs that do not fit go behind "N more" at the right, and the active
 * tab is always drawn, so the strip never shows a tab the user cannot see.
 */
export function TabStrip({
  layout,
  onSelect,
  onClose,
  onHome,
  unsaved,
  narrow = false,
}: TabStripProps) {
  const list = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  // The phone's strip: a narrow window under a finger. The scroll is no use with a mouse.
  const { coarse } = useViewport();
  const scrolls = narrow && coarse;
  const moreBox = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const { active } = layout;
  // The ids, not the count: a new tab with the same count is a new element to observe.
  const tabIds = layout.tabs.map((tab) => tab.id).join("\n");
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
  // on every frame of the glide. The bar is drawn TAB_MAX_WIDTH wide and scaled
  // down, not 1px wide and scaled up: at a fractional pixel ratio (Windows at
  // 150%) a 1px box snaps to whole device pixels before the scale, which drew
  // the bar a third wider than its tab.
  const [motion] = useState(() => {
    const paint = () => {
      if (bar.current === null) return;
      bar.current.style.transform = `translateX(${motion.x.value}px) scaleX(${motion.width.value / TAB_MAX_WIDTH})`;
    };
    return { x: new Spring(0, paint), width: new Spring(0, paint) };
  });
  // The labels too: a label that grows, or a web font that arrives, widens a tab
  // without changing the count, and the fold has to follow it.
  const labels = layout.tabs.map(tabLabel).join("\n");

  const { hidden, cap, open, setOpen } = useTabGeometry(
    list,
    motion,
    active,
    tabIds,
    labels,
    !scrolls,
  );
  const menuOpen = open && hidden.length > 0;

  // On a phone nothing folds, so the row scrolls and the active tab is
  // brought into it when it changes. Only the row is moved: the page stays put, so
  // the sticky strip does not jump with a tap.
  useLayoutEffect(() => {
    const row = list.current;
    const tab = row?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (!scrolls || !row || !tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
  }, [active, scrolls]);

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
  }, [menuOpen, setOpen]);

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
      className={`k-glass k-hairline sticky top-0 z-10 flex h-10 shrink-0 items-stretch font-sans text-k-13 pointer-coarse:h-11 max-md:pointer-coarse:text-k-15 ${
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
        // measured. The clip stops them from widening the page sideways. On a
        // phone the row is the scroller instead, with its bar hidden and
        // no pull past the end onto the page.
        className={`relative flex min-w-0 flex-1 items-stretch ${
          scrolls
            ? "overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "overflow-hidden"
        }`}
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
                  ? { maxWidth: Math.min(TAB_MAX_WIDTH, cap) }
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
              {/* Under a finger the active tab's slot is 44 px wide and the strip's
                  height, and its x fills it, so the target is the size of a finger. The
                  other tabs take no room for an x they cannot show, only the dot's own
                  width when unsaved. */}
              <span
                className={`relative size-4 shrink-0 self-center ${
                  selected
                    ? "pointer-coarse:h-auto pointer-coarse:w-11 pointer-coarse:self-stretch"
                    : dirty
                      ? "pointer-coarse:w-2"
                      : "pointer-coarse:h-auto pointer-coarse:w-0"
                }`}
              >
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
                  className={`flex size-4 items-center justify-center text-k-muted hover:text-k-ink ${
                    selected
                      ? "pointer-coarse:size-full pointer-coarse:visible"
                      : "pointer-coarse:hidden"
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
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-[200px] origin-left bg-k-accent"
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
