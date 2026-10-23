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
   * How many times the pane was opened at `line`.
   *
   * A second open at the line the pane already holds changes nothing else, and
   * the cursor has moved off it since: this is what tells the editor to go back.
   */
  jump?: number;
  /**
   * The herdr session it holds, absent unless this is a terminal pane.
   *
   * A pane holds a note or a terminal, never both. A comment rather than a
   * discriminated union: a union would rewrite every `pane.path` read site to
   * buy an invariant one branch in the route already holds, and it would cost
   * `mapPanes` the property that a terminal pane is skipped by a moved note
   * with no code at all, because following a move keys on `path`.
   */
  term?: string;
  /**
   * Set on a pane holding the todo list, absent on every other.
   *
   * A third field beside `path` and `term` for the reason `term` is a third
   * field: a union would rewrite every `pane.path` read site to buy an
   * invariant one branch in the route already holds.
   */
  todos?: boolean;
  /**
   * Set on a pane holding the log, absent on every other.
   *
   * A fifteenth optional field for the reason `todos` is the second, written out
   * above. A boolean because the log opens on today and moves by day from there,
   * so the pane holds no note to name.
   */
  log?: boolean;
  /**
   * The literature note whose book this pane is reading, absent otherwise.
   *
   * The note's path, not the book's: the note is the handle, and the reader
   * swaps the suffix to find the epub. A fourth optional field for the reason
   * `term` and `todos` are the third and the second, written out above.
   */
  book?: string;
  /**
   * The note whose practice exam this pane is sitting, absent otherwise.
   *
   * A fifth optional field for the reason `book` is the fourth, written out
   * above. It carries the note's path rather than a parsed exam: the pane reads
   * the note itself, so nothing here has to know what an exam is.
   */
  exam?: string;
  /**
   * Set on a pane holding the review, absent on every other.
   *
   * A seventh optional field for the reason `todos` is the second, written out
   * above. A boolean and not a deck, because the pane opens on the deck list
   * and picks its own deck from there, the way the todo pane opens on the whole
   * list rather than on a note.
   */
  review?: boolean;
  /**
   * The image this pane is showing, absent otherwise.
   *
   * The image's own path and not a note's, which is where this parts company
   * with `book` and `exam`: an image is referenced by any number of notes and
   * belongs to none of them, so there is no note to hold it by. A sixth
   * optional field for the reason `book` is the fourth, written out above.
   */
  image?: string;
  /**
   * The pdf this pane is showing, and the page it opened at, absent otherwise.
   *
   * The pdf's own path, for the reason `image` holds the image's: any number of
   * notes name a pdf and none owns it. A thirteenth optional field for the
   * reason `book` is the fourth, written out above.
   *
   * `opened` counts the opens, the way `jump` counts a note's: a second open
   * at the page the pane holds changes nothing else, and the reader may have
   * scrolled off it since. The pane reopens at `page` whenever this moves.
   */
  pdf?: { path: string; page?: number; opened: number };
  /**
   * The HTML page this pane is showing, absent otherwise.
   *
   * The page's own path, for the reason `image` holds the image's: nothing
   * pairs a page with a note. An eleventh optional field for the reason `book`
   * is the fourth, written out above.
   */
  html?: string;
  /** The heading a followed link named, where the page opens. Absent otherwise. */
  anchor?: string;
  /**
   * The note whose video this pane is playing, absent otherwise.
   *
   * The note's path and not the address, which is where this follows `book` and
   * `exam` rather than `image`: the link lives in the note, so the pane holds
   * the handle and a folder move that rewrites `path` carries the player with
   * it. An eighth optional field for the reason `book` is the fourth, written
   * out above.
   */
  video?: string;
  /**
   * The person note this pane is showing the card for, absent otherwise.
   *
   * The person's own note path, following `book` and `video` rather than
   * `image`: the card is read off that note and everything linking to it, so a
   * folder move that rewrites `path` carries the card with it. A ninth optional
   * field for the reason `book` is the fourth, written out above.
   */
  person?: string;
  /**
   * The note whose jj history this pane lists, absent otherwise.
   *
   * The note's path, following `person`: the pane reads the history and the
   * note's text by it, so a move that rewrites it carries the pane along. A
   * fourteenth optional field for the reason `book` is the fourth.
   */
  history?: string;
  /**
   * Set on a pane holding the graph, absent on every other.
   *
   * `around` names the note a local graph is drawn around, and is absent on
   * the graph of the whole vault. An object rather than the path alone, so the
   * whole vault has a value that is not an empty string standing for nothing.
   * A tenth optional field for the reason `book` is the fourth, written out
   * above.
   */
  graph?: { around?: string };
  /**
   * Set on a pane holding the chat, absent on every other.
   *
   * A boolean and not a session name, which is where this parts company with
   * `term`: the runner holds one session, and every chat pane is a view of it.
   * A twelfth optional field for the reason `todos` is the second, written out
   * above.
   */
  chat?: boolean;
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
  /**
   * Whether the focused pane is drawn on its own, the rest of the tab hidden
   * behind it.
   *
   * Per tab, the way the focus is, so zooming one says nothing about another.
   * A flag rather than the pane's id, because the pane drawn alone is always
   * the focused one: every move of the focus puts the tab back the way it was,
   * which is what tmux's own zoom does.
   */
  zoom?: boolean;
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
 * Write what the focused pane holds, replacing whatever it held.
 *
 * The pane is written whole under its own id, so nothing the last thing left
 * behind, a line or a page, survives into the next. Every opener in
 * `pane-contents.ts` ends here, which keeps the tree's shape this file's alone.
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
 * Move to one pane by id, which is what a click in it does.
 *
 * The same layout comes back when that pane already has the focus. Every focus
 * event inside a pane reports it, and a new object for each one would put the
 * route in a render loop over a change that never happened.
 */
export function focusPane(layout: Layout, id: string): Layout {
  const tab = activeTab(layout);
  return tab.focus === id ? layout : withTab(layout, { ...tab, focus: id, zoom: false });
}

/**
 * Trade places with another pane, the arrangement itself standing still.
 *
 * Each leaf carries its id and what it holds with it, so the focus needs no
 * moving: the pane you were in is the pane you are in, and it is somewhere
 * else on screen. React keys a pane by that id, so two panes of one split keep
 * the editors they hold, cursor and undo history and all; a swap across two
 * splits builds them again, there being no way to move a subtree between two
 * parents without React unmounting it.
 *
 * The route names the other pane, having read the boxes on screen the way it
 * reads them to move the focus. A pane of another tab, or the focused one
 * itself, is nothing to swap with.
 */
export function swapPanes(layout: Layout, id: string): Layout {
  const tab = activeTab(layout);
  const panes = tabPanes(layout);
  const here = panes.find((pane) => pane.id === tab.focus);
  const there = panes.find((pane) => pane.id === id);
  if (here === undefined || there === undefined || here.id === there.id) return layout;

  // An arrow rather than a declaration, so the compiler keeps what the guard
  // above proved about the two panes: a declaration is hoisted past it.
  const swap = (node: PaneNode): PaneNode => {
    if (isSplit(node)) return { ...node, children: node.children.map(swap) };
    if (node.id === here.id) return there;
    return node.id === there.id ? here : node;
  };

  return withTab(layout, { ...tab, root: swap(tab.root) });
}

/**
 * Draw the focused pane on its own, or put the tab back the way it was.
 *
 * Nothing is closed and nothing moves: the other panes are still there, still
 * holding what they held, and every function that moves the focus turns this
 * off again on its way past.
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

/** What a pane can hold. A pane holding none of these is empty, and the Today screen shows in it. */
const HOLDS = [
  "path",
  "term",
  "todos",
  "log",
  "book",
  "exam",
  "review",
  "image",
  "pdf",
  "html",
  "video",
  "person",
  "history",
  "graph",
  "chat",
] as const;

/**
 * Whether a tab is one pane holding nothing: the tab Today goes to.
 *
 * The same rule `NotePane` draws Today by, a pane with no note and none of the
 * other kinds, so the button and the screen agree on what an empty tab is.
 */
export function isEmptyTab(tab: Tab): boolean {
  const root = tab.root;
  return !isSplit(root) && HOLDS.every((key) => root[key] === undefined || root[key] === false);
}

/**
 * Close one tab, the active index following the tab that was active.
 *
 * When the active tab is the one closed, the tab sliding into its place takes
 * the index, or the last tab when the closed one was at the end. Closing the
 * last tab leaves an empty one, the same as a window that never had a note.
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
 * The same layout under ids made on this page, the focus of each tab following
 * its pane.
 *
 * A saved layout carries the ids of the page that saved it, and that page's
 * counter is not this one's: kept, the next split here could mint an id a
 * restored pane already has, and React would draw two panes as one.
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
