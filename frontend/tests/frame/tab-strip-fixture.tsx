/**
 * The tab strip's frame rig: the notes its tabs open, the workspace seeded
 * through the reader's `mount`, and the reads of the strip on screen. The
 * behaviour tests and the picture tests both mount through here.
 *
 * The `vi.mock` calls stay in each test file, because vitest hoists them there.
 */

import { waitFor } from "@testing-library/react";
import { fetchNote, NoteMissing } from "@/lib/api";
import { noteName } from "@/lib/note-path";
import { openInFocused } from "@/lib/pane-contents";
import { addTab, emptyLayout, goToTab, type Layout } from "@/lib/panes";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import {
  type Mounted,
  mount,
  need,
  PATIENCE,
  READER,
  type Size,
  type Theme,
  visibleEditor,
} from "./reader-fixture";

export const DESIGN = "Design Notes.md";
export const LONG = Array.from(
  { length: 12 },
  (_, index) => `Working notes on the reading tab strip ${String(index + 1).padStart(2, "0")}.md`,
);

const REDUCED = "(prefers-reduced-motion: reduce)";
const FINE_KEY = "kasten.workspace.1";
export const COARSE_KEY = "kasten.workspace.coarse.1";

/**
 * The long notes and the design notes answer their text, after the reader
 * fixture's answers, which still answer the reader's own note.
 */
export function registerTabNotes() {
  beforeEach(() => {
    const previous = vi.mocked(fetchNote).getMockImplementation();
    vi.mocked(fetchNote).mockImplementation(async (path: string) => {
      if (LONG.includes(path)) return `# ${noteName(path)}\n\nparagraph of ${noteName(path)}.\n`;
      if (path === DESIGN) return "# Design Notes\n\nparagraph of the design notes.\n";
      if (previous) return previous(path);
      throw new NoteMissing(path);
    });
  });
}

/** Twelve tabs, one long note each, the first one active. */
export function twelveTabs(): Layout {
  const [first = LONG[0], ...rest] = LONG;
  return goToTab(
    rest.reduce((layout, path) => openInFocused(addTab(layout), path), emptyLayout(first)),
    0,
  );
}

/** Two tabs: the reader in the first, active, and the design notes in the second. */
export function twoTabs(): Layout {
  return goToTab(openInFocused(addTab(emptyLayout(READER)), DESIGN), 0);
}

/**
 * Mounts the route with `layout` saved as this device's workspace, the
 * phone's under the coarse key and the desktop's under the fine one.
 */
export async function mountTabs(
  size: Size,
  theme: Theme,
  layout: Layout,
  reduced = false,
): Promise<Mounted> {
  const key = size.coarse ? COARSE_KEY : FINE_KEY;
  const mounted = await mount(size, theme, "/", "[role='tablist']", {
    [key]: JSON.stringify({ layout, treeOpen: false }),
  });
  if (reduced) stubMatchMedia({ [NARROW]: false, [COARSE]: size.coarse, [REDUCED]: true });
  await waitFor(
    () => expect(visibleEditor(mounted.host).textContent).toContain("paragraph"),
    PATIENCE,
  );
  return mounted;
}

/** The strip: the row that holds Today beside the tab list. */
export function stripOf(host: HTMLElement): HTMLElement {
  return need(host.querySelector<HTMLElement>("[role='tablist']"), "tab list")
    .parentElement as HTMLElement;
}

/** The tab wrappers the list lays out, in order, hidden ones included. */
export function wrappers(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("[role='tablist'] > [data-tab]")];
}

/** The wrappers on screen, which leaves out the ones folded behind "N more". */
export function drawn(host: HTMLElement): HTMLElement[] {
  return wrappers(host).filter((tab) => tab.getAttribute("aria-hidden") === null);
}

/** The "N more" button, or undefined while nothing is folded. */
export function moreButton(host: HTMLElement): HTMLButtonElement | undefined {
  return [...stripOf(host).querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    /more$/.test(button.textContent ?? ""),
  );
}

/** The underline: the bar the list draws under its tabs, which is not a tab. */
export function barOf(host: HTMLElement): HTMLElement {
  return need(
    host.querySelector<HTMLElement>("[role='tablist'] > span[aria-hidden='true']"),
    "underline",
  );
}

/** Whether the underline sits under this tab, to the pixel, with its width. */
export function underlineUnder(host: HTMLElement, tab: HTMLElement): boolean {
  const bar = barOf(host).getBoundingClientRect();
  const box = tab.getBoundingClientRect();
  return Math.abs(bar.left - box.left) < 1 && Math.abs(bar.width - box.width) < 1;
}

/** The pane headers on screen, which only a split draws. */
export function headers(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("[data-pane-header]")].filter(
    (header) => header.getClientRects().length > 0,
  );
}
