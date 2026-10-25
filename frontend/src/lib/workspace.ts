/**
 * The panes, splits and tabs a device had open, kept across a reload (#495).
 *
 * In this browser's storage and never in the vault, the way Obsidian keeps
 * `workspace.json` beside `workspace-mobile.json`: a phone and a desktop want
 * different arrangements of the same notes, and the vault is the notes. One
 * key per kind of pointer, so a phone and a laptop on one account never take
 * each other's layout, and a version in each key, so a shape this code no
 * longer reads is thrown away rather than half drawn.
 *
 * What a pane holds is saved, never the text in it: that is the vault's, and
 * text not yet written is `held-text.ts`'s.
 */

import { type Layout, type PaneNode, reidLayout } from "@/lib/panes";

const FINE_KEY = "kasten.workspace.1";
const COARSE_KEY = "kasten.workspace.coarse.1";

export interface Workspace {
  layout: Layout;
  treeOpen: boolean;
}

const keyFor = (coarse: boolean) => (coarse ? COARSE_KEY : FINE_KEY);

// A blocked or full storage throws a `DOMException` on any touch, as
// `vim-setting.ts` says. Each touch below reads that as nothing kept.
function touch<T>(work: () => T, otherwise: T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof DOMException) return otherwise;
    throw error;
  }
}

/**
 * The pane as it is worth keeping.
 *
 * `line` and `jump` belong to the open that set them, and a reload is not that
 * open again. The pdf's `opened` counts this page's opens, so the replacer
 * below drops it and a load starts it at 1; its `page` stays, being where the
 * reader was sent.
 */
function keptNode(node: PaneNode): PaneNode {
  if ("dir" in node) return { ...node, children: node.children.map(keptNode) };
  const { line: _line, jump: _jump, ...rest } = node;
  return rest;
}

/** Write the whole of what this device has open, over whatever was there. */
export function saveWorkspace(coarse: boolean, layout: Layout, treeOpen: boolean): void {
  const saved: Workspace = {
    layout: { ...layout, tabs: layout.tabs.map((tab) => ({ ...tab, root: keptNode(tab.root) })) },
    treeOpen,
  };
  const text = JSON.stringify(saved, (key, value) => (key === "opened" ? undefined : value));
  touch(() => localStorage.setItem(keyFor(coarse), text), undefined);
}

type Check = (value: unknown) => boolean;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString: Check = (value) => typeof value === "string";
const isTrue: Check = (value) => value === true;

/** Every field a saved pane may carry, and what each must be. */
const PANE: Record<string, Check> = {
  id: isString,
  path: isString,
  term: isString,
  todos: isTrue,
  log: isTrue,
  overview: isTrue,
  finance: isTrue,
  book: isString,
  exam: isString,
  review: isTrue,
  image: isString,
  pdf: (value) =>
    isObject(value) &&
    only(value, { path: isString, page: (page) => Number.isInteger(page) && Number(page) > 0 }, [
      "path",
    ]),
  html: isString,
  video: isString,
  person: isString,
  history: isString,
  graph: (value) => isObject(value) && only(value, { around: isString }),
  chat: isTrue,
};

/** Whether `value` holds the fields `fields` requires or allows, and nothing else. */
function only(
  value: Record<string, unknown>,
  fields: Record<string, Check>,
  required: string[] = [],
) {
  return (
    required.every((key) => key in value) &&
    Object.entries(value).every(([key, field]) => fields[key]?.(field) === true)
  );
}

/** Whether a node is a tree ending in panes, every pane id added to `seen` once. */
function isNode(value: unknown, seen: Set<string>): boolean {
  if (!isObject(value)) return false;
  if (!("dir" in value)) {
    if (!only(value, PANE, ["id"]) || seen.has(value.id as string)) return false;
    seen.add(value.id as string);
    return true;
  }
  const { id, dir, children, ...rest } = value;
  return (
    Object.keys(rest).length === 0 &&
    isString(id) &&
    (dir === "row" || dir === "col") &&
    Array.isArray(children) &&
    children.length > 0 &&
    children.every((child) => isNode(child, seen))
  );
}

function isTab(value: unknown, seen: Set<string>): boolean {
  if (!isObject(value)) return false;
  const { id, root, focus, zoom, ...rest } = value;
  const before = new Set(seen);
  return (
    Object.keys(rest).length === 0 &&
    isString(id) &&
    (zoom === undefined || typeof zoom === "boolean") &&
    isNode(root, seen) &&
    // The focus names a pane of this tab, not one another tab holds.
    isString(focus) &&
    seen.has(focus as string) &&
    !before.has(focus as string)
  );
}

function isWorkspace(value: unknown): value is Workspace {
  if (!isObject(value) || !isObject(value.layout) || typeof value.treeOpen !== "boolean") {
    return false;
  }
  const { tabs, active, ...rest } = value.layout;
  const seen = new Set<string>();
  return (
    Object.keys(value).length === 2 &&
    Object.keys(rest).length === 0 &&
    Array.isArray(tabs) &&
    tabs.length > 0 &&
    Number.isInteger(active) &&
    Number(active) >= 0 &&
    Number(active) < tabs.length &&
    tabs.every((tab) => isTab(tab, seen))
  );
}

function withOpened(node: PaneNode): PaneNode {
  if ("dir" in node) return { ...node, children: node.children.map(withOpened) };
  return node.pdf === undefined ? node : { ...node, pdf: { ...node.pdf, opened: 1 } };
}

/**
 * What this device had open, under ids of this page, or null with nothing to
 * restore.
 *
 * Anything that is not exactly the shape `saveWorkspace` writes, from a broken
 * write, another version or another app, is removed and read as nothing: a
 * layout half understood would draw a window nobody had open.
 */
export function loadWorkspace(coarse: boolean): Workspace | null {
  const key = keyFor(coarse);
  const raw = touch(() => localStorage.getItem(key), null);
  if (raw === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  if (!isWorkspace(value)) {
    touch(() => localStorage.removeItem(key), undefined);
    return null;
  }

  const layout = reidLayout(value.layout);
  return {
    layout: { ...layout, tabs: layout.tabs.map((tab) => ({ ...tab, root: withOpened(tab.root) })) },
    treeOpen: value.treeOpen,
  };
}
