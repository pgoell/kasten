import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { KindIcon, kindLabel, paneKind, panePath } from "@/components/kind-icons";
import type { PaneRect } from "@/lib/pane-direction";
import { isSplit, type Pane, type PaneNode, panesOf } from "@/lib/panes";
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

interface LayoutNodeProps {
  node: PaneNode;
  focus: string;
  onFocus: (id: string) => void;
  children: PaneLayoutProps["children"];
  divided: boolean;
  zoomed: string | null;
  /** The ids of the panes that arrived since this tab was last drawn. */
  fresh: ReadonlySet<string>;
  narrow: boolean;
  /** The axis a leaf slides in along: the one its parent split divides by. */
  enter: "x" | "y";
}

/** How far a new pane starts off its place, in px. */
const SLIDE = 36;

const REDUCED = "(prefers-reduced-motion: reduce)";

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

  return (
    <LayoutNode
      node={node}
      focus={focus}
      onFocus={onFocus}
      divided={divided}
      zoomed={zoomed}
      fresh={fresh}
      narrow={narrow}
      enter={narrow ? "y" : "x"}
    >
      {children}
    </LayoutNode>
  );
}

function LayoutNode({
  node,
  focus,
  onFocus,
  children,
  divided,
  zoomed,
  fresh,
  narrow,
  enter,
}: LayoutNodeProps) {
  // `display: none` takes the box out of the layout altogether, so what is
  // left shares the whole window. A split holding none of the zoomed pane goes
  // with them, or its share of the room would be held open around nothing.
  const hidden = zoomed !== null && !panesOf(node).some((pane) => pane.id === zoomed);

  if (!isSplit(node)) {
    return (
      <PaneLeaf
        pane={node}
        focused={node.id === focus}
        hidden={hidden}
        shown={divided && zoomed === null}
        onFocus={onFocus}
        fresh={fresh.has(node.id)}
        enter={enter}
      >
        {children}
      </PaneLeaf>
    );
  }

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 gap-0.5 bg-k-rule ${hidden ? "hidden" : ""} ${
        node.dir === "row" ? "flex-row" : "flex-col"
      }`}
    >
      {node.children.map((child) => (
        <LayoutNode
          key={child.id}
          node={child}
          focus={focus}
          onFocus={onFocus}
          divided={divided}
          zoomed={zoomed}
          fresh={fresh}
          narrow={narrow}
          enter={narrow || node.dir === "col" ? "y" : "x"}
        >
          {children}
        </LayoutNode>
      ))}
    </div>
  );
}

interface PaneLeafProps {
  pane: Pane;
  focused: boolean;
  hidden: boolean;
  /** Whether the pane has a header row and a focus line, which is only when others are drawn beside it. */
  shown: boolean;
  onFocus: (id: string) => void;
  children: PaneLayoutProps["children"];
  fresh: boolean;
  enter: "x" | "y";
}

function PaneLeaf({
  pane,
  focused,
  hidden,
  shown,
  onFocus,
  children,
  fresh,
  enter,
}: PaneLeafProps) {
  const element = useRef<HTMLDivElement>(null);
  useSlideIn(element, fresh, enter);

  const kind = paneKind(pane);
  const path = panePath(pane);

  return (
    // `onFocusCapture` rather than a click handler: clicking into a pane is
    // one way to reach it, and `gf` following a link into another one is not
    // a click at all. Both end with something inside the pane focused.
    <div
      ref={element}
      data-pane={pane.id}
      onFocusCapture={() => onFocus(pane.id)}
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-k-bg ${hidden ? "hidden" : ""}`}
    >
      {shown && (
        <>
          {/* The line is laid over the pane's top edge rather than given a row,
              and transparent when the pane is not focused, so the focus moves
              one colour and no box. */}
          <span
            aria-hidden="true"
            data-focus-line
            className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 ${
              focused ? "bg-k-accent" : "bg-transparent"
            }`}
          />
          <div
            data-pane-header
            className="flex h-7 shrink-0 items-center gap-2 border-b border-k-rule bg-k-bg px-3 text-k-muted"
          >
            <KindIcon kind={kind} />
            <span className="font-sans text-k-12">{kindLabel(kind)}</span>
            {path !== undefined && (
              <span title={path} className="min-w-0 truncate font-mono text-k-12">
                {path}
              </span>
            )}
          </div>
        </>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children(pane, focused)}</div>
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
