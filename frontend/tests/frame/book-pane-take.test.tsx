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
  selectUnder,
  takeIn,
  toastIn,
  until,
} from "./book-take-fixture";
import {
  api,
  buttonNamed,
  inside,
  type Mounted,
  onTop,
  setUp,
  tearDown,
} from "./html-take-fixture";

const { fetchBook } = vi.hoisted(() => ({ fetchBook: vi.fn() }));
// `fetchBook` is the one call the book reads from the vault that a plain fetch cannot answer.
// Every other name is the real module's, so the take writes to the stub the way it does live.
vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
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

  /** A take high on the page, so its toast shows at the foot of the text column. */
  async function takeHigh(mode: string): Promise<{ doc: Document; toast: HTMLElement }> {
    localStorage.setItem("kasten.vim", mode);
    await page.viewport(1440, 900);
    api.notes[NOTE] = PLAIN;
    mountBooks(mounted, [NOTE]);
    const doc = await sectionOf(NOTE);
    await focusPara(mounted, NOTE, doc);
    selectPara(doc);
    await vi.waitFor(() => expect(takeIn(mounted, NOTE)).not.toBeNull());
    await userEvent.keyboard("y");
    await until(() => toastIn(mounted, NOTE).includes("Undo"), 5_000);
    const toast = paneOf(mounted, NOTE).querySelector('[role="status"]') as HTMLElement;
    return { doc, toast };
  }

  it.each(["on", "off"])(
    "with a mouse and vim mode %s, a new selection under the toast keeps its Take button on top (#1482)",
    async (mode) => {
      const { doc, toast } = await takeHigh(mode);
      expect(onTop(buttonNamed("Undo") as HTMLElement), "the toast's own Undo").toBe(true);
      expect(selectUnder(doc, toast.getBoundingClientRect()), "words under the toast").toBe(true);
      await vi.waitFor(() => expect(takeIn(mounted, NOTE)).not.toBeNull());

      const button = takeIn(mounted, NOTE) as HTMLElement;
      const at = button.getBoundingClientRect();
      const box = toast.getBoundingClientRect();
      expect({
        under: at.top < box.bottom && at.bottom > box.top,
        onTop: onTop(button),
      }).toEqual({ under: true, onTop: true });
      await userEvent.click(button);
      await until(() => (api.notes[NOTE]?.match(/\^hl-/g) ?? []).length === 2, 5_000);
      expect(api.notes[NOTE]?.match(/\^hl-/g)).toHaveLength(2);
    },
    40_000,
  );

  it("the contents overlay still covers a selection's Take button (#1482)", async () => {
    const { doc, toast } = await takeHigh("off");
    expect(selectUnder(doc, toast.getBoundingClientRect())).toBe(true);
    await vi.waitFor(() => expect(takeIn(mounted, NOTE)).not.toBeNull());
    await userEvent.keyboard("t");
    await until(() => paneOf(mounted, NOTE).querySelector('[role="dialog"]') !== null);

    const button = takeIn(mounted, NOTE) as HTMLElement;
    const sheet = paneOf(mounted, NOTE).querySelector('[role="dialog"]') as HTMLElement;
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    expect({ button: onTop(button), sheet: sheet.contains(hit) }).toEqual({
      button: false,
      sheet: true,
    });
  }, 40_000);

  it("at 390 with touch, a second selection's footer Take stays in reach while the toast shows (#1482)", async () => {
    await page.viewport(390, 844);
    await browser.emulateMedia({ touch: true });
    api.notes[NOTE] = PLAIN;
    mountBooks(mounted, [NOTE]);
    const doc = await sectionOf(NOTE);
    const pane = paneOf(mounted, NOTE);
    const footerTake = () => pane.querySelector<HTMLElement>("footer [data-take]");
    selectPara(doc);
    await vi.waitFor(() => expect(footerTake()).not.toBeNull());
    await userEvent.click(footerTake() as HTMLElement);
    await until(() => toastIn(mounted, NOTE).includes("Undo"), 5_000);

    const toast = pane.querySelector('[role="status"]') as HTMLElement;
    expect(selectUnder(doc, toast.getBoundingClientRect())).toBe(true);
    await vi.waitFor(() => expect(footerTake()).not.toBeNull());
    expect(onTop(footerTake() as HTMLElement)).toBe(true);
    await userEvent.click(footerTake() as HTMLElement);
    await until(() => (api.notes[NOTE]?.match(/\^hl-/g) ?? []).length === 2, 5_000);
    expect(api.notes[NOTE]?.match(/\^hl-/g)).toHaveLength(2);
  }, 40_000);

  /** Selects the first paragraph and takes it, with `y` or, on a phone, the footer Take. */
  async function takeAt(width: number, height: number, touch: boolean): Promise<HTMLElement> {
    await page.viewport(width, height);
    await browser.emulateMedia({ touch });
    api.notes[NOTE] = PLAIN;
    mountBooks(mounted, [NOTE]);
    const doc = await sectionOf(NOTE);
    if (!touch) await focusPara(mounted, NOTE, doc);
    selectPara(doc);
    await vi.waitFor(() => expect(takeIn(mounted, NOTE)).not.toBeNull());
    if (touch) await userEvent.click(takeIn(mounted, NOTE) as HTMLElement);
    else await userEvent.keyboard("y");
    await until(() => toastIn(mounted, NOTE).includes("Undo"), 5_000);
    return paneOf(mounted, NOTE).querySelector('[role="status"]') as HTMLElement;
  }

  // A short split at 1440, a short phone pane, and a normal height that keeps the whole toast.
  it.each([
    [1440, 230, false, "on"],
    [1440, 230, false, "off"],
    [390, 230, true, "off"],
    [1440, 900, false, "off"],
  ])(
    "at %ix%i (touch %s, vim %s) the toast keeps to its title and buttons only in a text column under 200 px (#1486)",
    async (width, height, touch, mode) => {
      localStorage.setItem("kasten.vim", mode as string);
      const toast = await takeAt(width as number, height as number, touch as boolean);
      const column = toast.parentElement as HTMLElement;
      const host = column.firstElementChild as HTMLElement;
      const pane = paneOf(mounted, NOTE);
      const [title, passage, source] = [...toast.querySelectorAll("p")];
      const buttons = [buttonNamed("Put it in a note"), buttonNamed("Undo")] as HTMLElement[];
      const short = (height as number) < 400;
      const box = column.getBoundingClientRect();
      const row = column.parentElement as HTMLElement;
      const widths = [...row.children].reduce((sum, c) => sum + c.getBoundingClientRect().width, 0);
      expect({
        short: column.clientHeight < 200,
        // A size container must not shrink the column: it still runs from the header to the footer, and fills the row beside the side columns.
        fills: [
          box.top === pane.querySelector("header")?.getBoundingClientRect().bottom,
          box.bottom === pane.querySelector("footer")?.getBoundingClientRect().top,
          Math.abs(widths - row.getBoundingClientRect().width) < 1,
        ],
        host:
          JSON.stringify(host.getBoundingClientRect()) ===
          JSON.stringify(column.getBoundingClientRect()),
        title: (title?.offsetHeight ?? 0) > 0,
        passage: (passage?.offsetHeight ?? 0) > 0,
        source: (source?.offsetHeight ?? 0) > 0,
        whole: toast.scrollHeight <= toast.clientHeight && inside(toast, column),
        buttons: buttons.map((b) => inside(b, toast) && onTop(b)),
      }).toEqual({
        short,
        fills: [true, true, true],
        host: true,
        title: true,
        passage: !short,
        source: !short,
        whole: true,
        buttons: [true, true],
      });

      await userEvent.click(buttonNamed("Undo") as HTMLElement);
      await until(() => !(api.notes[NOTE] ?? "").includes(PARA), 5_000);
      expect(api.notes[NOTE]).not.toContain(PARA);
    },
    40_000,
  );
});
