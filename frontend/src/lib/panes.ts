/**
 * How the window is divided, and what is open in each division.
 *
 * A tab holds a tree: panes at the leaves, splits above them. A split is a row
 * or a column of any number of children, not a pair, which is what keeps three
 * panes side by side even thirds instead of a half and two quarters. Splitting
 * inserts beside the focused pane and `normalize` flattens the result back into
 * its parent whenever the two divide the same way.
 *
 * Everything here is pure and returns a new layout. The route holds one of
 * these in state and the keys are these functions; nothing in this file knows
 * about React, the vault or the URL, which is what makes the arrangement
 * testable without rendering anything.
 */

/** One pane, and whichever note is open in it. */
export interface Pane {
  id: string;
  /** The note it holds, absent while the pane is empty. */
  path?: string;
  /** Line the editor opens on, which only a search hit names. */
  line?: number;
  /**
   * The tmux session it holds, absent unless this is a terminal pane.
   *
   * A pane holds a note or a terminal, never both. A comment rather than a
   * discriminated union: a union would rewrite every `pane.path` read site to
   * buy an invariant one branch in the route already holds, and it would cost
   * `mapPanes` the property that a terminal pane is skipped by a moved note
   * with no code at all, because following a move keys on `path`.
   */
  term?: string;
}

/** A row or a column of panes, or of further splits. */
export interface Split {
  /**
   * Its own id, for the same reason a pane has one: React keys the tree off
   * these. Without it a split would be keyed by its position, and dividing one
   * pane would re-key its neighbour, throwing away the CodeMirror view in it
   * along with the cursor and the undo history of a note nobody touched.
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
}

export interface Layout {
  tabs: Tab[];
  /** Which tab is on screen, by position. */
  active: number;
}

// A counter rather than `crypto.randomUUID`. These ids never leave the browser
// and never outlive the page, so all they have to be is different from each
// other, and a counter reads the same in a test failure every time.
let made = 0;

function nextId(kind: string): string {
  made += 1;
  return `${kind}${made}`;
}

export function isSplit(node: PaneNode): node is Split {
  return "dir" in node;
}

/**
 * Read an index the compiler cannot trust, and say so loudly if it is empty.
 *
 * `noUncheckedIndexedAccess` is on, and the invariants that make each of these
 * safe are structural rather than typed: a layout always holds a tab, a tab
 * always ends in a pane, and the focus always names one of them. Standing a
 * made-up tab or pane in would draw a window nobody asked for and hide the bug
 * that got here; this names it instead.
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
 * Straighten a tree after an insert or a removal.
 *
 * Two jobs, and both are about keeping the tree the smallest one that draws
 * this arrangement. A split holding one child is that child. A split inside a
 * split dividing the same way is one split, which is what makes a third pane in
 * a row a third of the width rather than a quarter.
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
 * Open a note in the focused pane.
 *
 * The pane is written whole rather than patched, so a line left over from the
 * search hit that opened the last note cannot survive into one that names none
 * and drop the cursor somewhere arbitrary.
 */
export function openInFocused(layout: Layout, path: string, line?: number): Layout {
  const tab = activeTab(layout);
  return withTab(layout, {
    ...tab,
    root: replaceLeaf(tab.root, tab.focus, { id: tab.focus, path, line }),
  });
}

/**
 * Put a terminal in the focused pane, replacing whatever was there.
 *
 * Written whole for the reason `openInFocused` writes one whole: the note and
 * the line it opened on are gone, not left behind under a terminal.
 */
export function openTerminalInFocused(layout: Layout, session: string): Layout {
  const tab = activeTab(layout);
  return withTab(layout, {
    ...tab,
    root: replaceLeaf(tab.root, tab.focus, { id: tab.focus, term: session }),
  });
}

/** Take the note out of the focused pane, leaving the pane itself on screen. */
export function clearFocused(layout: Layout): Layout {
  const tab = activeTab(layout);
  return withTab(layout, { ...tab, root: replaceLeaf(tab.root, tab.focus, { id: tab.focus }) });
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
 * Close the focused pane, and the tab with it when it was the last one there.
 *
 * The second half of what `<leader>q` does: the route empties a pane holding a
 * note first, and this runs once there is nothing left in it. The layout comes
 * back untouched on the last pane of the last tab, because an app with nothing
 * on screen is not a state worth being able to reach.
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
  // Whichever pane slid into the closed one's place, or the last one when the
  // closed pane was at the end. Landing back at the start would be a jump.
  const landed = must(remaining[Math.min(at, remaining.length - 1)], "pane after the close");

  return withTab(layout, { ...tab, root, focus: landed.id });
}

/** Move to the next pane of this tab, wrapping at the end. */
export function nextPane(layout: Layout): Layout {
  const tab = activeTab(layout);
  const order = panesOf(tab.root);
  const at = order.findIndex((pane) => pane.id === tab.focus);

  const landed = must(order[(at + 1) % order.length], "next pane");

  return withTab(layout, { ...tab, focus: landed.id });
}

/**
 * Move to one pane by id, which is what a click in it does.
 *
 * The same layout comes back when that pane already has the focus. Every focus
 * event inside a pane reports it, and a new object for each one would put the
 * route in a render loop over a change that never happened.
 */
export function focusPane(layout: Layout, id: string): Layout {
  const tab = activeTab(layout);
  return tab.focus === id ? layout : withTab(layout, { ...tab, focus: id });
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
 * Rewrite every pane in every tab, which is how a moved note is followed.
 *
 * The panes of tabs that are not on screen are rewritten too: a note that moved
 * moved for all of them. Keep each pane's id, or the tab holding it loses track
 * of what has the focus.
 */
export function mapPanes(layout: Layout, fn: (pane: Pane) => Pane): Layout {
  function walk(node: PaneNode): PaneNode {
    return isSplit(node) ? { ...node, children: node.children.map(walk) } : fn(node);
  }

  return { ...layout, tabs: layout.tabs.map((tab) => ({ ...tab, root: walk(tab.root) })) };
}
