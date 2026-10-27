/**
 * The take out of a real book pane, in real Chromium (#789): a passage selected
 * in the text, `y` or the button takes it into the book's note, the toast says
 * so, and the passage is marked. Desktop and vim mode both ways, a phone with
 * touch, and two panes side by side.
 */

import "./html-take-api";
import { renderHook } from "@testing-library/react";
import { commands as browser, page, userEvent } from "vitest/browser";
import { useVim } from "@/lib/editor/vim-setting";
import plainUrl from "../fixtures/plain.epub?url";
import { located, rootToken, sections } from "./book-pane-fixture";
import {
  focusPara,
  marksIn,
  mountBooks,
  PARA,
  PLAIN,
  paneOf,
  sectionOf,
  selectPara,
  takeIn,
  toastIn,
  until,
} from "./book-take-fixture";
import { api, type Mounted, setUp, tearDown } from "./html-take-fixture";

const { fetchBook } = vi.hoisted(() => ({ fetchBook: vi.fn() }));
// `fetchBook` is the one call the book reads from the vault that a plain fetch cannot answer.
// Every other name is the real module's, so the take writes to the stub the way it does live.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchBook,
}));

const NOTE = "20 Literature/Plain.md";
const LEFT = "20 Literature/Left.md";
const RIGHT = "20 Literature/Right.md";

let mounted: Mounted;

beforeEach(async () => {
  located.length = 0;
  sections.length = 0;
  mounted = await setUp();
  // Every pane reads the plain fixture, whatever its note is called.
  const bytes = await (await fetch(plainUrl)).blob();
  fetchBook.mockImplementation(async (note: string) => ({
    path: note.replace(/\.md$/, ".epub"),
    blob: bytes,
  }));
});

afterEach(async () => {
  await tearDown(mounted);
});

describe("the take out of a book pane", () => {
  it.each(["on", "off"])(
    "takes with y in vim mode %s, marks the words in the mark colour and shows the toast",
    async (mode) => {
      localStorage.setItem("kasten.vim", mode);
      const vim = renderHook(() => useVim());
      expect(vim.result.current, "the vim setting this case names").toBe(mode === "on");
      vim.unmount();
      api.notes[NOTE] = PLAIN;
      mountBooks(mounted, [NOTE]);
      const doc = await sectionOf(NOTE);
      await focusPara(mounted, NOTE, doc);
      selectPara(doc);
      await vi.waitFor(() => expect(takeIn(mounted, NOTE)).not.toBeNull());

      await userEvent.keyboard("y");
      // Each wait ends on the thing itself, or after its bound, so a red run still reaches every check.
      await until(() => api.notes[NOTE]?.includes(PARA) ?? false, 5_000);
      await until(() => toastIn(mounted, NOTE).includes("Taken into the book's note"));
      await until(() => marksIn(mounted, NOTE).length === 1);

      expect.soft(api.notes[NOTE]).toContain("## Highlights");
      expect.soft(api.notes[NOTE]).toContain(PARA);
      expect.soft(toastIn(mounted, NOTE)).toContain("Taken into the book's note");
      expect.soft(toastIn(mounted, NOTE)).toContain("Undo");
      expect.soft(marksIn(mounted, NOTE)).toHaveLength(1);
      expect(rootToken("--k-mark")).not.toBe("");
      expect.soft(marksIn(mounted, NOTE)[0]?.getAttribute("fill")).toBe(rootToken("--k-mark"));
    },
    40_000,
  );

  it("at 390 with touch, one pane hides both columns, and the footer Take is 44 px and takes", async () => {
    await page.viewport(390, 844);
    await browser.emulateMedia({ touch: true });
    api.notes[NOTE] = PLAIN;
    mountBooks(mounted, [NOTE]);
    const doc = await sectionOf(NOTE);
    const pane = paneOf(mounted, NOTE);
    // A phone holds the text alone: no contents, no taken column.
    expect(pane.querySelector('nav[aria-label="Book contents"]')).toBeNull();
    expect(pane.querySelector('section[aria-label="Taken"]')).toBeNull();

    selectPara(doc);
    const button = await vi.waitFor(() => {
      const found = pane.querySelector<HTMLElement>("footer [data-take]");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

    await userEvent.click(button);
    await until(() => api.notes[NOTE]?.includes(PARA) ?? false, 5_000);
    await until(() => toastIn(mounted, NOTE).includes("Taken into the book's note"));

    expect.soft(api.notes[NOTE]).toContain(PARA);
    expect.soft(toastIn(mounted, NOTE)).toContain("Taken into the book's note");
  }, 40_000);

  it("in one of two panes, a selection's Take answers in that pane only", async () => {
    api.notes[LEFT] = "# Left\n";
    api.notes[RIGHT] = "# Right\n";
    mountBooks(mounted, [LEFT, RIGHT]);
    const doc = await sectionOf(RIGHT);
    await focusPara(mounted, RIGHT, doc);
    selectPara(doc);
    await vi.waitFor(() => expect(takeIn(mounted, RIGHT)).not.toBeNull());

    expect(takeIn(mounted, LEFT)).toBeNull();
    await userEvent.keyboard("y");
    await until(() => api.notes[RIGHT]?.includes(PARA) ?? false, 5_000);

    expect.soft(api.notes[RIGHT]).toContain(PARA);
    expect.soft(api.notes[LEFT]).toBe("# Left\n");
    expect.soft(toastIn(mounted, LEFT)).toBe("");
  }, 40_000);
});
