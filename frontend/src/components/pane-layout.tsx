import { type CSSProperties, type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { KindIcon, kindLabel, paneKind, panePath } from "@/components/kind-icons";
import { Leaving, useBlurWhenLeaving, useLeaving } from "@/lib/leaving";
import type { PaneRect } from "@/lib/pane-direction";
import { isSplit, type Pane, type PaneNode, panesOf, type Split } from "@/lib/panes";
import { SPRINGS, Spring } from "@/lib/spring";

interface PaneLayoutProps {
  node: PaneNode;
  /** Which pane holds the focus, by id, so a leaf can tell whether it is the one. */
  focus: string;
  onFocus: (id: string) => void;
  /** What to draw inside one pane, which only the route can decide. */
  children: (pane: Pane, focused: boolean) => ReactNode;
  /** Whether the tab has more than one pane, which is when saying so is worth it. */
  divided: boolean;
  /**
   * The pane drawn on its own, or null while the whole tab is drawn.
   *
   * The rest are hidden rather than taken down, so a zoom costs nothing: the
   * editors keep their cursors and their unwritten text, a terminal keeps its
   * socket, and a video keeps playing where it was.
   */
  zoomed?: string | null;
  /**
   * The tab these panes belong to, so a tab drawn before is not taken for a new
   * one when it comes back on screen.
   */
  tabId?: string;
  /** Whether the window is narrow, when the panes are stacked and a new one comes in from below. */
  narrow?: boolean;
}

/** A pane's place in the window, in percent of the window from each edge. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const WINDOW: Box = { left: 0, top: 0, right: 100, bottom: 100 };

interface Placed {
  pane: Pane;
  box: Box;
  /** The axis the pane slides in along: the one its parent split divides by. */
  enter: "x" | "y";
}

/** How far a new pane starts off its place, in px. */
const SLIDE = 36;

const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * One tab's panes, drawn flat from the tree that arranges them.
 *
 * Every pane is a direct child of one container, keyed by its id, in a box worked
 * out from the tree: each split gives its children equal shares of its own box
 * along its direction, which is what flex gave, three panes in a row being thirds
 * rather than a half and two quarters. Nothing here measures anything.
 *
 * The tree is never drawn, so it can change around a pane without remounting it
 * (#935). React keeps an editor only while its element and key stay the same, and
 * a nested split is a container that would be taken down and built again when a
 * pane moved into it. A split, a fold or a swap moves a pane's box and leaves its
 * node where it is.
 *
 * The rules between panes are the container's own background showing through a
 * two pixel gap, so dividing the window costs no elements to draw lines with.
 * The rules are neutral, so the accent is left for the focus: a shown pane
 * names itself in a header row and marks the focused one with a line at its top.
 */
export function PaneLayout({
  node,
  focus,
  onFocus,
  children,
  divided,
  zoomed = null,
  tabId = "",
  narrow = false,
}: PaneLayoutProps) {
  // The ids each tab's panes had the last time that tab was drawn. A tab switch
  // brings in panes that are all new to the screen, so this is kept per tab: a
  // pane is new only when its tab has been drawn before and it was not there.
  // Written after the commit, so a render React throws away changes nothing.
  const drawn = useRef(new Map<string, ReadonlySet<string>>());
  const ids = panesOf(node).map((pane) => pane.id);
  const before = drawn.current.get(tabId);
  const fresh = new Set(before === undefined ? [] : ids.filter((id) => !before.has(id)));
  useLayoutEffect(() => {
    drawn.current.set(tabId, new Set([...(drawn.current.get(tabId) ?? []), ...ids]));
  });

  // The window is the root for a lone pane too, which is a leaf placed as a row would place it.
  const placed: Placed[] = [];
  place(node, WINDOW, "row", narrow, placed);

  // The panes of the tab that was drawn before and is not on screen now. They
  // stay where they were, hidden, until the next task (`useLeaving`). A pane
  // that is current again is not drawn twice.
  const gone = useLeaving(tabId, placed);
  const departed = gone.flatMap((each) => each.value).filter((each) => !ids.includes(each.pane.id));

  // One list for both, so a pane that goes and comes back keeps its key and its
  // node: React matches children across renders only within the same list.
  const leaves = [
    ...placed.map((each) => ({ ...each, leaving: false })),
    ...departed.map((each) => ({ ...each, leaving: true })),
  ];

  return (
    <div className="relative min-h-0 min-w-0 flex-1 bg-k-rule">
      {leaves.map(({ pane, box, enter, leaving }) => (
        <PaneLeaf
          key={pane.id}
          pane={pane}
          focused={!leaving && pane.id === focus}
          // A zoomed pane takes the whole window, and the rest stay mounted behind it.
          hidden={!leaving && zoomed !== null && pane.id !== zoomed}
          box={pane.id === zoomed ? WINDOW : box}
          shown={divided && zoomed === null && !leaving}
          onFocus={onFocus}
          fresh={!leaving && fresh.has(pane.id)}
          enter={enter}
          leaving={leaving}
        >
          {children}
        </PaneLeaf>
      ))}
    </div>
  );
}

/**
 * Give every pane under this node its box, each split dividing its own box among
 * its children along its direction. The list comes out in `panesOf` order.
 *
 * On a narrow window every split is stacked whatever its stored direction, a
 * side-by-side pair being strips nobody can read. The tree keeps its direction,
 * so the pair is side by side again when the window widens.
 */
function place(node: PaneNode, box: Box, dir: Split["dir"], narrow: boolean, out: Placed[]) {
  if (!isSplit(node)) {
    out.push({ pane: node, box, enter: narrow || dir === "col" ? "y" : "x" });
    return;
  }

  const row = !narrow && node.dir === "row";
  const count = node.children.length;
  const start = row ? box.left : box.top;
  const end = row ? box.right : box.bottom;
  // The outer edges are taken as they are, so a last pane ends exactly at the box's
  // edge and not at a rounding of it, which would draw a sliver of gap there.
  const edge = (at: number) =>
    at === 0 ? start : at === count ? end : start + ((end - start) * at) / count;

  node.children.forEach((child, at) => {
    const next = row
      ? { ...box, left: edge(at), right: edge(at + 1) }
      : { ...box, top: edge(at), bottom: edge(at + 1) };
    place(child, next, node.dir, narrow, out);
  });
}

/**
 * A box as CSS, inset a pixel from each edge that is not the window's own. Two
 * neighbours then leave the two pixels between them that the rules show through.
 */
function insetOf(box: Box): CSSProperties {
  return {
    left: box.left > 0 ? `calc(${box.left}% + 1px)` : "0",
    top: box.top > 0 ? `calc(${box.top}% + 1px)` : "0",
    right: box.right < 100 ? `calc(${100 - box.right}% + 1px)` : "0",
    bottom: box.bottom < 100 ? `calc(${100 - box.bottom}% + 1px)` : "0",
  };
}

interface PaneLeafProps {
  pane: Pane;
  focused: boolean;
  hidden: boolean;
  box: Box;
  /** Whether the pane has a header row and a focus line, which is only when others are drawn beside it. */
  shown: boolean;
  onFocus: (id: string) => void;
  children: PaneLayoutProps["children"];
  fresh: boolean;
  enter: "x" | "y";
  /**
   * Whether the pane is on its way out: hidden and inert, and no longer a pane
   * to the layout, so the keys and the rects ignore it. See `useLeaving`.
   */
  leaving?: boolean;
}

function PaneLeaf({
  pane,
  focused,
  hidden,
  box,
  shown,
  onFocus,
  children,
  fresh,
  enter,
  leaving = false,
}: PaneLeafProps) {
  const element = useRef<HTMLDivElement>(null);
  useSlideIn(element, fresh, enter);
  useBlurWhenLeaving(element, leaving);

  const kind = paneKind(pane);
  const path = panePath(pane);

  return (
    // `onFocusCapture` rather than a click handler: clicking into a pane is
    // one way to reach it, and `gf` following a link into another one is not
    // a click at all. Both end with something inside the pane focused.
    <div
      ref={element}
      data-pane={leaving ? undefined : pane.id}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      onFocusCapture={leaving ? undefined : () => onFocus(pane.id)}
      style={insetOf(box)}
      className={`absolute flex min-h-0 min-w-0 flex-col overflow-hidden bg-k-bg ${hidden || leaving ? "hidden" : ""}`}
    >
      {shown && (
        <>
          {/* The line is laid over the pane's top edge rather than given a row,
              and transparent when the pane is not focused, so the focus moves
              one colour and no box. z-[1] keeps it under the strip's own menus. */}
          <span
            aria-hidden="true"
            data-focus-line
            className={`pointer-events-none absolute inset-x-0 top-0 z-[1] h-0.5 ${
              focused ? "bg-k-accent" : "bg-transparent"
            }`}
          />
          <div
            data-pane-header
            className="flex h-7 shrink-0 items-center gap-2 border-b border-k-rule bg-k-bg px-3 text-k-muted"
          >
            <KindIcon kind={kind} />
            <span className="font-sans text-k-12 text-k-ink-soft">{kindLabel(kind)}</span>
            {path !== undefined && (
              <span title={path} className="min-w-0 truncate font-mono text-k-12">
                {path}
              </span>
            )}
          </div>
        </>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Leaving.Provider value={leaving}>{children(pane, focused)}</Leaving.Provider>
      </div>
    </div>
  );
}

/**
 * A pane made after the layout first drew slides in from its side and fades in as it comes.
 *
 * Once, on mount, and only for a pane `PaneLayout` calls fresh: a pane that is
 * merely moved or redrawn is not new. Transform and opacity alone, so the
 * browser does the work and nothing is laid out again for each frame.
 */
function useSlideIn(element: RefObject<HTMLDivElement | null>, fresh: boolean, enter: "x" | "y") {
  // A layout effect, so the pane is already at its start when the browser paints.
  // A passive effect can let one frame show the pane in its place first.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a pane slides in on mount only, so a later change to these is not a new pane.
  useLayoutEffect(() => {
    const el = element.current;
    if (!fresh || el === null) return;
    // Reduced motion keeps the fade and loses the slide. The pane starts
    // transparent, the browser is made to paint that, and then the opacity
    // transitions up. The inline style goes once the transition has ended.
    if (matchMedia(REDUCED).matches) {
      el.style.opacity = "0";
      el.getBoundingClientRect();
      el.style.transition = "opacity var(--k-hover) var(--k-ease-out)";
      el.style.opacity = "1";
      // transitionend bubbles, so a transition inside the pane comes here too:
      // only the pane's own opacity ending is the fade ending.
      const done = (event: TransitionEvent) => {
        if (event.target !== el || event.propertyName !== "opacity") return;
        el.removeEventListener("transitionend", done);
        el.style.transition = "";
        el.style.opacity = "";
      };
      el.addEventListener("transitionend", done);
      return;
    }
    const spring = new Spring(SLIDE, (offset) => {
      el.style.transform = enter === "x" ? `translateX(${offset}px)` : `translateY(${offset}px)`;
      el.style.opacity = `${1 - offset / SLIDE}`;
    });
    // Set at the start before the spring runs, so the first frame is not the pane in its place.
    spring.set(SLIDE);
    void spring.to(0, SPRINGS.split).then((done) => {
      // Cleared rather than left at zero, so the pane is back to no transform at all.
      if (!done) return;
      el.style.transform = "";
      el.style.opacity = "";
    });
    return () => spring.stop();
  }, []);
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
