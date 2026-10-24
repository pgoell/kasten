/**
 * The phone's two key sheets in a real browser (#793): the Space sheet and key
 * help, each a full-width bottom sheet at 390x844 with touch, with vim on and
 * off. The route is mounted on a note, so the toolbar's space button and the
 * `?` key are the ones a reader presses.
 */

import { waitFor } from "@testing-library/react";
import {
  fontsIn,
  leader,
  type Mounted,
  mount,
  need,
  nextFrame,
  PATIENCE,
  READER,
  registerReaderFixture,
  TOUCH,
  unmount,
  visibleEditor,
} from "./reader-fixture";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerReaderFixture();

const VIM = ["on", "off"] as const;
const SPACE = "button[aria-label='Show the leader keys']";
const LEADER = "[role='dialog'][aria-label='Leader keys']";
const HELP = "[role='dialog'][aria-label='Keyboard shortcuts']";
/** A finger's target, the least height a row of either sheet may be. */
const ROW_MIN = 44;

/** The reader on its note at a phone, with vim as asked. */
async function mountPhone(vim: (typeof VIM)[number]): Promise<Mounted> {
  const mounted = await mount(
    TOUCH,
    "light",
    `/?note=${encodeURIComponent(READER)}`,
    "[data-reader-grid]",
    { "kasten.vim": vim },
  );
  await waitFor(
    () => expect(visibleEditor(mounted.host).textContent).toContain("paragraph"),
    PATIENCE,
  );
  await fontsIn();
  return mounted;
}

/** The sheet's offset in px, read from its inline transform. NaN once it is gone. */
function offsetOf(panel: HTMLElement | null): number {
  const match = /,\s*(-?[\d.e+-]+)px/.exec(panel?.style.transform ?? "");
  return match ? Number(match[1]) : Number.NaN;
}

/** Waits for a sheet to be in the page, then returns it. */
async function sheetOf(selector: string): Promise<HTMLElement> {
  await expect.poll(() => document.querySelector(selector), PATIENCE).not.toBeNull();
  return need(document.querySelector<HTMLElement>(selector), selector);
}

/** Waits for the sheet to come to rest at the foot, where a reader sees it. */
async function atRest(panel: HTMLElement) {
  await expect.poll(() => offsetOf(panel), PATIENCE).toBe(0);
}

function centreOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A pointer event as a finger sends it. The button is held from down to move. */
function pointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function key(target: Element, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

/**
 * Space opens the leader the way a reader does it: on a vim note the key itself,
 * and with vim off, where Space is a letter, the toolbar's space button.
 */
function openLeader(host: HTMLElement, vim: (typeof VIM)[number]) {
  if (vim === "on") leader(host, [" "]);
  else {
    // The reader was typing in the note, so the editor holds the focus when the button is tapped.
    visibleEditor(host).focus();
    tapSpace();
  }
}

/** The toolbar's space button, pressed as a tap: down, up, then the click. */
function tapSpace() {
  const space = need(document.querySelector<HTMLButtonElement>(SPACE), "space button");
  const at = centreOf(space);
  pointer(space, "pointerdown", at.x, at.y);
  pointer(space, "pointerup", at.x, at.y);
  space.click();
}

describe("phone key sheets", () => {
  it.each(VIM)(
    "#793 A8 the Space sheet rows are full width, 44 px tall and one column after g, vim %s",
    async (vim) => {
      const mounted = await mountPhone(vim);
      try {
        openLeader(mounted.host, vim);
        const panel = await sheetOf(LEADER);
        await atRest(panel);

        const body = need(panel.querySelector<HTMLElement>(".overflow-y-auto"), "sheet body");
        // The body's own padding is 8 px a side, and the row fills what is left.
        const width = body.clientWidth - 16;
        const rows = [...panel.querySelectorAll<HTMLElement>("button")];
        expect(rows.length).toBeGreaterThan(20);
        for (const row of rows) {
          const box = row.getBoundingClientRect();
          const name = row.textContent ?? "";
          expect.soft(box.height, `${name} height`).toBeGreaterThanOrEqual(ROW_MIN);
          expect.soft(box.width, `${name} width`).toBeGreaterThanOrEqual(width - 1);
        }

        key(panel, "g");
        await nextFrame();
        await nextFrame();

        // After g the groups are still stacked down one column at one left edge.
        const groups = [...panel.querySelectorAll("section")].filter((one) =>
          one.querySelector("h3"),
        );
        expect(groups.length).toBeGreaterThan(0);
        const lefts = new Set(groups.map((one) => Math.round(one.getBoundingClientRect().left)));
        expect(lefts.size).toBe(1);
        const tops = groups.map((one) => one.getBoundingClientRect().top);
        expect([...tops].sort((a, b) => a - b)).toEqual(tops);
      } finally {
        await unmount(mounted);
      }
    },
  );

  it.each(VIM)(
    "#793 A9 key help is a full-height sheet in one column with the filter focused, vim %s",
    async (vim) => {
      const mounted = await mountPhone(vim);
      try {
        const space = need(document.querySelector<HTMLButtonElement>(SPACE), "space button");
        space.focus();
        // Pressed on the toolbar's button, which is not text, so `?` opens the help.
        key(space, "?");

        const help = await sheetOf(HELP);
        await atRest(help);

        // Full height up to the top safe area, which is 0 in this browser.
        const box = help.getBoundingClientRect();
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.top).toBeLessThan(window.innerHeight * 0.1);
        expect(box.height).toBeGreaterThanOrEqual(window.innerHeight * 0.9);

        // The two columns stack: the second starts below the first at the same left.
        const columns = [...help.querySelectorAll("h2")].map(
          (heading) => heading.closest("section") as HTMLElement,
        );
        expect(columns).toHaveLength(2);
        const [first, second] = columns.map((one) => one.getBoundingClientRect());
        expect(Math.round(second?.left ?? -1)).toBe(Math.round(first?.left ?? -2));
        expect(second?.top).toBeGreaterThanOrEqual(first?.bottom ?? Number.POSITIVE_INFINITY);

        const filter = need(help.querySelector<HTMLInputElement>("input"), "filter field");
        expect(document.activeElement).toBe(filter);
      } finally {
        await unmount(mounted);
      }
    },
  );

  it.each(VIM)(
    "#793 I4 Esc closes key help and gives the focus back to the opener, vim %s",
    async (vim) => {
      const mounted = await mountPhone(vim);
      try {
        const space = need(document.querySelector<HTMLButtonElement>(SPACE), "space button");
        space.focus();
        key(space, "?");

        const help = await sheetOf(HELP);
        await atRest(help);
        key(need(help.querySelector("input"), "filter field"), "Escape");

        await expect.poll(() => document.querySelector(HELP), PATIENCE).toBeNull();
        expect(document.activeElement).toBe(space);
      } finally {
        await unmount(mounted);
      }
    },
  );

  it.each(VIM)("#793 I4 a drag down on the key help grabber closes it, vim %s", async (vim) => {
    const mounted = await mountPhone(vim);
    try {
      const space = need(document.querySelector<HTMLButtonElement>(SPACE), "space button");
      space.focus();
      key(space, "?");

      const help = await sheetOf(HELP);
      await atRest(help);

      const grabber = need(help.querySelector<HTMLElement>("[data-sheet-drag]"), "grabber");
      const start = centreOf(grabber);
      // Dragged past half the sheet, which closes it by distance and not by speed.
      pointer(grabber, "pointerdown", start.x, start.y);
      pointer(grabber, "pointermove", start.x, start.y + 500);
      pointer(grabber, "pointerup", start.x, start.y + 500);

      await expect.poll(() => document.querySelector(HELP), PATIENCE).toBeNull();
    } finally {
      await unmount(mounted);
    }
  });
});
