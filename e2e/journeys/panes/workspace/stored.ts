import type { Page } from "@playwright/test";
import { panes } from "../../../harness/app.ts";
import { expect } from "../../../harness/stack.ts";

export const FINE = "kasten.workspace.1";
export const COARSE = "kasten.workspace.coarse.1";
export const HELD = "kasten.held.2";
export const TYPED = "typed and never saved";

/** The text a pane's editor holds, by position among the visible panes. */
export const paneText = (page: Page, index: number) =>
  panes(page).nth(index).locator(".cm-content").textContent();

/**
 * Puts these keys into storage before the first load only, as a page before this one did; a
 * reload then reads what the app itself wrote.
 */
export async function seed(page: Page, entries: Record<string, string>): Promise<void> {
  await page.addInitScript((pairs) => {
    if (sessionStorage.getItem("e2e.seeded")) return;
    for (const [key, value] of Object.entries(pairs)) localStorage.setItem(key, value);
    sessionStorage.setItem("e2e.seeded", "1");
  }, entries);
}

/** A layout under the fine pointer's key, tree open, as `seed` takes it. */
export const layout = (tabs: unknown[], active = 0) => ({
  [FINE]: JSON.stringify({ layout: { tabs, active }, treeOpen: true }),
});

/** Held text for a note, as a failed write left it in storage. */
export const held = (path: string, reason = "PUT failed with 500") => ({
  [HELD]: JSON.stringify({ [path]: [{ content: TYPED, reason, conflicted: false }] }),
});

/** A tab of two panes side by side, the first focused. */
export const beside = (left: object, right: object) => ({
  id: "t",
  root: { id: "s", dir: "row", children: [{ id: "a", ...left }, { id: "b", ...right }] },
  focus: "a",
});

/** Loads the app on a stored layout and waits for the tree, with no click that moves the focus. */
export async function load(page: Page, url = "/"): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("button", { name: "Welcome", exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

type Node = { id: string; dir?: string; children?: Node[] };

/** A stored workspace with its ids taken out and each tab's focus by position, or null. */
export function normal(raw: string | null): unknown {
  if (raw === null) return null;
  const leaves = (node: Node): Node[] => node.children?.flatMap(leaves) ?? [node];
  const strip = (node: Node): unknown =>
    node.children ? { dir: node.dir, children: node.children.map(strip) } : { ...node, id: 0 };
  const { layout, treeOpen } = JSON.parse(raw);
  return {
    treeOpen,
    active: layout.active,
    tabs: layout.tabs.map((tab: { root: Node; focus: string; zoom?: boolean }) => ({
      zoom: tab.zoom,
      focus: leaves(tab.root).findIndex((leaf) => leaf.id === tab.focus),
      root: strip(tab.root),
    })),
  };
}

/** One storage key as the page holds it. */
export const stored = (page: Page, key: string) =>
  page.evaluate((name) => localStorage.getItem(name), key);

/** The workspace the page stored under one device's key, as `normal` reads it. */
export const saved = async (page: Page, key = FINE) => normal(await stored(page, key));

/** Which visible pane holds the focus, by position, or -1. */
export const focusedPane = (page: Page) =>
  page
    .locator("[data-pane]:visible")
    .evaluateAll((all) => all.findIndex((pane) => pane.contains(document.activeElement)));

/** Every path a PUT went to, in order. */
export function puts(page: Page): string[] {
  const paths: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "PUT" && path.startsWith("/api/files/")) {
      paths.push(decodeURIComponent(path.slice("/api/files/".length)));
    }
  });
  return paths;
}
