import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { noteName } from "@/lib/note-path";
import type { PaneRect } from "@/lib/pane-direction";
import { isSplit, type Layout, type Pane, type PaneNode, panesOf, type Tab } from "@/lib/panes";
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
 * Each pane draws its own border on top of that, blue on the focused one, so
 * where a pane ends and which one is listening are both on screen.
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
        divided={divided}
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
      className={`flex min-h-0 min-w-0 flex-1 gap-0.5 bg-k-accent-wash ${hidden ? "hidden" : ""} ${
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
  divided: boolean;
  onFocus: (id: string) => void;
  children: PaneLayoutProps["children"];
  fresh: boolean;
  enter: "x" | "y";
}

function PaneLeaf({
  pane,
  focused,
  hidden,
  divided,
  onFocus,
  children,
  fresh,
  enter,
}: PaneLeafProps) {
  const element = useRef<HTMLDivElement>(null);
  useSlideIn(element, fresh, enter);

  return (
    // `onFocusCapture` rather than a click handler: clicking into a pane is
    // one way to reach it, and `gf` following a link into another one is not
    // a click at all. Both end with something inside the pane focused.
    <div
      ref={element}
      data-pane={pane.id}
      onFocusCapture={() => onFocus(pane.id)}
      className={`min-h-0 min-w-0 flex-1 overflow-hidden bg-k-bg ${hidden ? "hidden" : ""} ${
        // Only worth drawing once there is another pane it could have been.
        // An undivided window has one pane and the border says nothing.
        //
        // A border rather than a ring or an outline: the editor fills the pane
        // and paints its own background over both of those. The border is the
        // one edge the children cannot reach, because they are laid out
        // inside it. Every pane carries one, so taking the focus changes its
        // colour and moves nothing.
        divided ? (focused ? "border border-k-accent" : "border border-k-rule") : ""
      }`}
    >
      {children(pane, focused)}
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
      el.addEventListener(
        "transitionend",
        () => {
          el.style.transition = "";
          el.style.opacity = "";
        },
        { once: true },
      );
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

/** What one tab is called: its number, and what is in the pane it left focused. */
function tabLabel(tab: Tab): string {
  const focused = panesOf(tab.root).find((pane) => pane.id === tab.focus);
  // A terminal pane names its herdr session, which is the thing you named it.
  if (focused?.term !== undefined) return focused.term;
  if (focused?.todos === true) return "todos";
  if (focused?.log === true) return "log";
  if (focused?.chat === true) return "chat";
  // A reader names the note it reads beside, which is the only name it has.
  if (focused?.book !== undefined) return noteName(focused.book);
  // A player names the note it plays beside, which is the only name it has.
  if (focused?.video !== undefined) return noteName(focused.video);
  // A pdf, an image and a page are files and not notes, so they are named the
  // way Obsidian names a tab holding one: by the file, less its suffix (#361).
  if (focused?.pdf !== undefined) return baseName(focused.pdf.path);
  if (focused?.image !== undefined) return baseName(focused.image);
  if (focused?.html !== undefined) return baseName(focused.html);
  // An exam and a card are each about one note, and are named by it (#363).
  if (focused?.exam !== undefined) return noteName(focused.exam);
  if (focused?.person !== undefined) return noteName(focused.person);
  // Not the note's name alone, which the note's own tab already carries.
  if (focused?.history !== undefined) return `history of ${noteName(focused.history)}`;
  if (focused?.graph !== undefined) {
    const { around } = focused.graph;
    return around === undefined ? "graph view" : `graph of ${noteName(around)}`;
  }
  if (focused?.review === true) return "review";
  return focused?.path === undefined ? "empty" : noteName(focused.path);
}

/**
 * A file's name without its folder or its suffix: `x/my plan.pdf` is `my plan`.
 *
 * The last suffix only, where `noteName` takes off `.md` alone: these files
 * come in a dozen suffixes, and `report.v2.pdf` is `report.v2` and not `report`.
 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
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
 *
 * More tabs than the window is wide scroll sideways rather than squeeze, which
 * on a phone is the third tab, and the active one is kept on screen.
 */
export function TabStrip({ layout, onSelect }: TabStripProps) {
  const strip = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const { active } = layout;
  const count = layout.tabs.length;

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

  // The labels too: a label that grows, or a web font that arrives, widens a tab
  // without changing the count, and the bar has to follow it.
  const labels = layout.tabs.map(tabLabel).join("\n");
  // Follows the active tab, the count and the labels. None of the three is read
  // here: the tab is found from the active index and the rest only triggers it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: all three are the trigger, and none of them is read.
  useLayoutEffect(() => {
    const tab = strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[active];
    if (tab === undefined) {
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
    // every tab at once, so each tab is watched. jsdom has no observer, where
    // the labels are the only trigger.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    for (const element of strip.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [active, count, labels]);

  // The count as well as the index: closing a tab to the left of the active one
  // moves it without changing which tab it is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: both are the trigger, and neither is read.
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, count]);

  if (count < 2) return null;

  return (
    <div
      ref={strip}
      role="tablist"
      // The scrollbar is left out: it would take a row of its own on a desktop
      // to say what the cut-off tab at the edge already says. The strip is glass
      // and stays put, so the page scrolls under it, and the one hairline is
      // the only rule it draws.
      className="k-glass k-hairline sticky top-0 z-10 flex shrink-0 overflow-x-auto font-mono text-[11px] [scrollbar-width:none]"
    >
      {layout.tabs.map((tab, index) => {
        const selected = index === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            // The digit that jumps here, which is the key rather than the
            // position: the tenth tab is reached with `0`.
            onClick={() => onSelect(index)}
            className={`shrink-0 px-3 py-1 whitespace-nowrap pointer-coarse:min-h-11 ${
              selected ? "text-k-ink" : "text-k-muted hover:bg-k-surface"
            }`}
          >
            <span className="text-k-accent">{(index + 1) % 10}</span> {tabLabel(tab)}
          </button>
        );
      })}
      {/* Inside the strip so it scrolls with the tabs. The strip is already
          positioned (it is sticky), which is what an absolute child needs. */}
      <span
        ref={bar}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-px origin-left bg-k-accent"
      />
    </div>
  );
}
