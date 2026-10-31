/**
 * How the window is divided into tabs and panes. A tab holds a tree: panes at the leaves, splits
 * above them, each split holding any number of children. Everything here is pure and returns a new
 * layout; nothing in this file knows React, the vault or the URL.
 */

import type { Direction } from "@/lib/pane-direction";
import { heldKind, type Pane } from "@/lib/pane-kinds";

export type { Pane };

/** A row or a column of panes, or of further splits. */
export interface Split {
  /**
   * Its own id, as a pane has. Without one React would key a split by position, and dividing a pane
   * would re-key its neighbour and throw away that editor's cursor and undo history.
   */
  id: string;
  /** `row` sets its children side by side, `col` stacks them. */
  dir: "row" | "col";
  children: PaneNode[];
}

export type PaneNode = Pane | Split;

export interface Tab {
  id: string;
  root: PaneNode;
  /** Which pane in this tab has the focus, by id. Each tab keeps its own. */
  focus: string;
  /**
   * Whether the focused pane is drawn alone, the rest hidden. Per tab, as the focus is. A flag:
   * the zoomed pane is always the focused one, and any focus move clears it.
   */
  zoom?: boolean;
}

export interface Layout {
  tabs: Tab[];
  /** Which tab is on screen, by position. */
  active: number;
}

// A counter, not `crypto.randomUUID`: these ids never leave the page, and a counter reads the same
// in a test failure.
let made = 0;

function nextId(kind: string): string {
  made += 1;
  return `${kind}${made}`;
}

export function isSplit(node: PaneNode): node is Split {
  return "dir" in node;
}

/**
 * Reads an index the compiler cannot trust, and throws if it is empty. The invariants behind each
 * call (a tab, a pane, a focus) are structural, so a made-up value would only hide the bug.
 */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`kasten: no ${what}`);
  return value;
}

/** Every pane under this node, left to right and top to bottom. */
export function panesOf(node: PaneNode): Pane[] {
  return isSplit(node) ? node.children.flatMap(panesOf) : [node];
}

/**
 * Keeps the tree minimal: a split with one child is that child, and a same-direction split inside
 * another merges into it, so a third pane in a row gets a third of the width.
 */
function normalize(node: PaneNode): PaneNode {
  if (!isSplit(node)) return node;

  const children = node.children
    .map(normalize)
    .flatMap((child) => (isSplit(child) && child.dir === node.dir ? child.children : [child]));

  const [only] = children;
  return only !== undefined && children.length === 1 ? only : { ...node, children };
}

export function emptyLayout(path?: string, line?: number): Layout {
  const pane: Pane = { id: nextId("pane"), path, line };
  return { tabs: [{ id: nextId("tab"), root: pane, focus: pane.id }], active: 0 };
}

export function activeTab(layout: Layout): Tab {
  return must(layout.tabs[layout.active], "active tab");
}

/** Every pane on screen, in the order they are laid out. */
export function tabPanes(layout: Layout): Pane[] {
  return panesOf(activeTab(layout).root);
}

export function focusedPane(layout: Layout): Pane {
  const panes = tabPanes(layout);
  // The first pane is not reached while the invariant holds: every function
  // that changes a tree sets the focus in the same breath.
  return panes.find((pane) => pane.id === activeTab(layout).focus) ?? must(panes[0], "pane");
}

function withTab(layout: Layout, next: Tab): Layout {
  return { ...layout, tabs: layout.tabs.map((tab, at) => (at === layout.active ? next : tab)) };
}

function replaceLeaf(node: PaneNode, target: string, next: Pane): PaneNode {
  if (!isSplit(node)) return node.id === target ? next : node;
  return { ...node, children: node.children.map((child) => replaceLeaf(child, target, next)) };
}

/**
 * Writes what the focused pane holds, replacing whatever it held. The pane is written whole under
 * its id, so a line or a page from the last thing never survives into the next.
 */
export function fillFocused(layout: Layout, content: Omit<Pane, "id">): Layout {
  const tab = activeTab(layout);
  return withTab(layout, {
    ...tab,
    root: replaceLeaf(tab.root, tab.focus, { id: tab.focus, ...content }),
  });
}

function insertBeside(node: PaneNode, target: string, made: Pane, dir: Split["dir"]): PaneNode {
  if (!isSplit(node)) {
    return node.id === target ? { id: nextId("split"), dir, children: [node, made] } : node;
  }
  return {
    ...node,
    children: node.children.map((child) => insertBeside(child, target, made, dir)),
  };
}

/** Divide the focused pane, putting an empty one beside it and moving there. */
export function splitFocused(layout: Layout, dir: Split["dir"]): Layout {
  const tab = activeTab(layout);
  const pane: Pane = { id: nextId("pane") };

  return withTab(layout, {
    ...tab,
    root: normalize(insertBeside(tab.root, tab.focus, pane, dir)),
    focus: pane.id,
    zoom: false,
  });
}

/** The tree without one pane, or null when that pane was all of it. */
function without(node: PaneNode, target: string): PaneNode | null {
  if (!isSplit(node)) return node.id === target ? null : node;

  const children = node.children
    .map((child) => without(child, target))
    .filter((child) => child !== null);

  return children.length === 0 ? null : { ...node, children };
}

/**
 * Closes the focused pane, and its tab when it was the last there. The layout comes back untouched
 * on the last pane of the last tab, so the app is never left with nothing on screen.
 */
export function removeFocused(layout: Layout): Layout {
  const tab = activeTab(layout);
  const order = panesOf(tab.root);
  const at = order.findIndex((pane) => pane.id === tab.focus);
  const stripped = without(tab.root, tab.focus);

  if (stripped === null) {
    if (layout.tabs.length === 1) return layout;
    const tabs = layout.tabs.filter((_, index) => index !== layout.active);
    return { tabs, active: Math.min(layout.active, tabs.length - 1) };
  }

  const root = normalize(stripped);
  const remaining = panesOf(root);
  // The pane that slid into the closed one's place; landing at the start would be a jump.
  const landed = must(remaining[Math.min(at, remaining.length - 1)], "pane after the close");

  return withTab(layout, { ...tab, root, focus: landed.id, zoom: false });
}

/** Move to the next pane of this tab, wrapping at the end. */
export function nextPane(layout: Layout): Layout {
  const tab = activeTab(layout);
  const order = panesOf(tab.root);
  const at = order.findIndex((pane) => pane.id === tab.focus);

  const landed = must(order[(at + 1) % order.length], "next pane");

  return withTab(layout, { ...tab, focus: landed.id, zoom: false });
}

/**
 * Moves to one pane by id, as a click does. Returns the same layout when that pane already has
 * focus, since every focus event reports it and a new object would loop the render.
 */
export function focusPane(layout: Layout, id: string): Layout {
  const tab = activeTab(layout);
  return tab.focus === id ? layout : withTab(layout, { ...tab, focus: id, zoom: false });
}

/**
 * Trades places with another pane of this tab, the arrangement otherwise standing still. The focus
 * stays on the same pane, now elsewhere.
 */
export function swapPanes(layout: Layout, id: string): Layout {
  const tab = activeTab(layout);
  const panes = tabPanes(layout);
  const here = panes.find((pane) => pane.id === tab.focus);
  const there = panes.find((pane) => pane.id === id);
  if (here === undefined || there === undefined || here.id === there.id) return layout;

  // An arrow, not a hoisted declaration, so TypeScript keeps the narrowing from the guard above.
  const swap = (node: PaneNode): PaneNode => {
    if (isSplit(node)) return { ...node, children: node.children.map(swap) };
    if (node.id === here.id) return there;
    return node.id === there.id ? here : node;
  };

  return withTab(layout, { ...tab, root: swap(tab.root) });
}

/** Whether the focused pane can go to this edge: not a lone pane, a zoomed one, or one already filling it. */
export function canMoveToEdge(layout: Layout, side: Direction): boolean {
  const { root, zoom, focus } = activeTab(layout);
  if (!isSplit(root) || zoom) return false;
  const first = side === "left" || side === "up";
  const fills = root.children[first ? 0 : root.children.length - 1]?.id === focus;
  return !(fills && root.dir === (side === "left" || side === "right" ? "row" : "col"));
}

/**
 * Takes the focused pane out and sets it along one edge of the window, at that edge's full length,
 * as vim's `<C-w>L` does. Stands still where `canMoveToEdge` says no.
 */
export function movePaneToEdge(layout: Layout, side: Direction): Layout {
  const tab = activeTab(layout);
  const here = focusedPane(layout);
  const rest = without(tab.root, here.id);
  if (rest === null || !canMoveToEdge(layout, side)) return layout;

  const dir = side === "left" || side === "right" ? "row" : "col";
  const children = side === "left" || side === "up" ? [here, rest] : [rest, here];
  return withTab(layout, {
    ...tab,
    root: normalize({ id: nextId("split"), dir, children }),
  });
}

/**
 * Draws the focused pane alone, or puts the tab back. Nothing closes or moves, and any focus
 * move turns zoom off.
 */
export function toggleZoom(layout: Layout): Layout {
  const tab = activeTab(layout);
  return withTab(layout, { ...tab, zoom: tab.zoom !== true });
}

/** Start a tab on one empty pane, and go to it. */
export function addTab(layout: Layout): Layout {
  const pane: Pane = { id: nextId("pane") };

  return {
    tabs: [...layout.tabs, { id: nextId("tab"), root: pane, focus: pane.id }],
    active: layout.tabs.length,
  };
}

/** Walk the tabs, wrapping at either end. */
export function stepTab(layout: Layout, delta: number): Layout {
  const count = layout.tabs.length;
  return { ...layout, active: (layout.active + delta + count) % count };
}

/** Go to one tab by position. A digit naming a tab that is not open does nothing. */
export function goToTab(layout: Layout, index: number): Layout {
  return index < layout.tabs.length ? { ...layout, active: index } : layout;
}

/**
 * Whether a tab is one pane holding nothing, the tab Today goes to. `NotePane` draws Today by the
 * same rule, so the button and the screen agree.
 */
export function isEmptyTab(tab: Tab): boolean {
  const root = tab.root;
  return !isSplit(root) && heldKind(root) === undefined;
}

/**
 * Closes one tab, keeping the active index on the tab that was active. Closing the last tab leaves
 * an empty one.
 */
export function closeTab(layout: Layout, index: number): Layout {
  if (layout.tabs.length === 1) return emptyLayout();
  const tabs = layout.tabs.filter((_, at) => at !== index);
  const active =
    index < layout.active ? layout.active - 1 : Math.min(layout.active, tabs.length - 1);
  return { tabs, active };
}

/** Go to the first tab that is one empty pane, or start a new tab when there is none. */
export function homeTab(layout: Layout): Layout {
  const at = layout.tabs.findIndex(isEmptyTab);
  return at === -1 ? addTab(layout) : goToTab(layout, at);
}

/**
 * The same layout under ids minted on this page, each tab's focus following its pane. A saved
 * layout carries another page's ids, and keeping them could give a split an id a pane has.
 */
export function reidLayout(layout: Layout): Layout {
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => {
      const renamed = new Map<string, string>();
      const walk = (node: PaneNode): PaneNode => {
        if (isSplit(node))
          return { ...node, id: nextId("split"), children: node.children.map(walk) };
        const id = nextId("pane");
        renamed.set(node.id, id);
        return { ...node, id };
      };
      const root = walk(tab.root);
      return {
        ...tab,
        id: nextId("tab"),
        root,
        focus: must(renamed.get(tab.focus), "focused pane"),
      };
    }),
  };
}
