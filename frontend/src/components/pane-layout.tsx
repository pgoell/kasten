import type { ReactNode } from "react";
import { noteName } from "@/lib/note-path";
import type { PaneRect } from "@/lib/pane-direction";
import { isSplit, type Layout, type Pane, type PaneNode, panesOf, type Tab } from "@/lib/panes";

interface PaneLayoutProps {
  node: PaneNode;
  /** Which pane holds the focus, by id, so a leaf can tell whether it is the one. */
  focus: string;
  onFocus: (id: string) => void;
  /** What to draw inside one pane, which only the route can decide. */
  children: (pane: Pane, focused: boolean) => ReactNode;
  /** Whether the tab has more than one pane, which is when saying so is worth it. */
  divided: boolean;
}

/**
 * One tab's panes, drawn from the tree that arranges them.
 *
 * Flex the whole way down, so the browser divides the room and nothing here
 * measures anything: each child takes an equal share of its split, and a split
 * nested inside one takes a single share as a whole. That is what makes the
 * flattening in `panes.ts` visible, three panes in a row being thirds rather
 * than a half and two quarters.
 *
 * The rules between panes are the container's own background showing through a
 * two pixel gap, so dividing the window costs no elements to draw lines with.
 * Each pane draws its own border on top of that, blue on the focused one, so
 * where a pane ends and which one is listening are both on screen.
 */
export function PaneLayout({ node, focus, onFocus, children, divided }: PaneLayoutProps) {
  if (!isSplit(node)) {
    const focused = node.id === focus;
    return (
      // `onFocusCapture` rather than a click handler: clicking into a pane is
      // one way to reach it, and `gf` following a link into another one is not
      // a click at all. Both end with something inside the pane focused.
      <div
        data-pane={node.id}
        onFocusCapture={() => onFocus(node.id)}
        className={`min-h-0 min-w-0 flex-1 overflow-hidden bg-one-bg ${
          // Only worth drawing once there is another pane it could have been.
          // An undivided window has one pane and the border says nothing.
          //
          // A border rather than a ring or an outline: the editor fills the pane
          // and paints its own background over both of those. The border is the
          // one edge the children cannot reach, because they are laid out
          // inside it. Every pane carries one, so taking the focus changes its
          // colour and moves nothing.
          divided ? (focused ? "border border-one-accent" : "border border-one-line") : ""
        }`}
      >
        {children(node, focused)}
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 gap-0.5 bg-one-selection ${
        node.dir === "row" ? "flex-row" : "flex-col"
      }`}
    >
      {node.children.map((child) => (
        <PaneLayout key={child.id} node={child} focus={focus} onFocus={onFocus} divided={divided}>
          {children}
        </PaneLayout>
      ))}
    </div>
  );
}

/**
 * Where every pane sits on screen, read at the moment a direction key is pressed.
 *
 * Here rather than in the route because this file writes the attribute they are
 * found by, and reading rather than watching because the answer is only wanted
 * on a keystroke: a `ResizeObserver` would keep a copy of the layout up to date
 * all day for the handful of times anybody asks.
 */
export function paneRects(): PaneRect[] {
  return [...document.querySelectorAll<HTMLElement>("[data-pane]")].map((element) => {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { id: element.dataset.pane ?? "", left, top, right, bottom };
  });
}

/** What one tab is called: its number, and the note in the pane it left focused. */
function tabLabel(tab: Tab): string {
  const focused = panesOf(tab.root).find((pane) => pane.id === tab.focus);
  return focused?.path === undefined ? "empty" : noteName(focused.path);
}

interface TabStripProps {
  layout: Layout;
  onSelect: (index: number) => void;
}

/**
 * The strip naming the open tabs, drawn only once there is more than one.
 *
 * One tab is the ordinary way to work, and a bar that spends a row of the
 * window saying "1" is chrome that earns nothing. It appears when it starts
 * carrying something worth reading and not before.
 */
export function TabStrip({ layout, onSelect }: TabStripProps) {
  if (layout.tabs.length < 2) return null;

  return (
    <div role="tablist" className="flex shrink-0 gap-px bg-one-line font-mono text-[11px]">
      {layout.tabs.map((tab, index) => {
        const active = index === layout.active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            // The digit that jumps here, which is the key rather than the
            // position: the tenth tab is reached with `0`.
            onClick={() => onSelect(index)}
            className={`px-3 py-1 ${
              active ? "bg-one-bg text-one-fg" : "bg-one-panel text-one-muted hover:bg-one-hover"
            }`}
          >
            <span className="text-one-accent">{(index + 1) % 10}</span> {tabLabel(tab)}
          </button>
        );
      })}
    </div>
  );
}
