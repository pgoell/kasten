/**
 * The book finder under a finger on a phone, and its pictures (#502).
 *
 * jsdom has no touch and lays nothing out, so this runs in a real browser with
 * a real finger from the DevTools protocol, as `picture-tap.test.tsx` does. A
 * click would test the mouse, and the row's height for a thumb comes from
 * `pointer: coarse`, which only touch emulation turns on.
 *
 * The route wants a backend to mount, so this stops at the finder and the
 * path it hands over. The route gives that path to `openBookInFocused`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { cdp, page } from "vitest/browser";
import { NoteFinder } from "@/components/note-finder";
import { shot } from "./shots";
import "@/styles/app.css";

const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn(() => Promise.resolve("")) }));
// A preview would read the note, so a read at all is a preview drawn. Named in
// full because the module is replaced whole and the editor behind the preview
// imports the rest.
vi.mock("@/lib/api", () => ({
  fetchNote,
  fetchImages: () => Promise.resolve([]),
  uploadAsset: () => Promise.resolve(),
}));

const BOOKS = "04 Ressources/02 Literature/01 Books";
const DUNE = `${BOOKS}/Science Fiction/Dune.md`;

/** A books folder with subfolders, a paper beside a pdf, and notes with no book at all. */
const PATHS = [
  DUNE,
  `${BOOKS}/Science Fiction/Hyperion.md`,
  `${BOOKS}/Philosophy/Meditations.md`,
  `${BOOKS}/Thinking, Fast and Slow.md`,
  "04 Ressources/02 Literature/02 Papers/Attention Is All You Need.md",
  "00 Inbox/Shopping.md",
  "01 Projects/kasten.md",
];

/** What the vault holds beside the notes: four epubs, a pdf, and a picture. */
const ASSETS = [
  `${BOOKS}/Science Fiction/Dune.epub`,
  `${BOOKS}/Science Fiction/Hyperion.epub`,
  `${BOOKS}/Philosophy/Meditations.epub`,
  `${BOOKS}/Thinking, Fast and Slow.epub`,
  "04 Ressources/02 Literature/02 Papers/Attention Is All You Need.pdf",
  "00 Inbox/receipt.png",
];

let root: Root | undefined;
let host: HTMLElement | undefined;

async function mount(
  onOpen: (path: string) => void,
  paths = PATHS,
  assets = ASSETS,
): Promise<void> {
  host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={new QueryClient()}>
        <NoteFinder paths={paths} books={assets} onOpen={onOpen} onClose={() => {}} />
      </QueryClientProvider>,
    );
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  fetchNote.mockClear();
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await page.viewport(414, 896);
});

/** A phone: 414 wide and a finger for a pointer, which is what `pointer: coarse` reads. */
async function phone(): Promise<void> {
  await page.viewport(414, 896);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
}

/** The finder's rows, in the order drawn. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

/**
 * A finger put down on the middle of `element` and lifted again.
 *
 * The point goes into the page's coordinates, which is what the DevTools
 * protocol takes: the test runs in a frame placed inside that page. It is
 * checked to land on the row, a span of it included, and not beside it.
 */
async function tap(element: Element): Promise<void> {
  const box = element.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  expect(element.contains(document.elementFromPoint(x, y))).toBe(true);
  const frame = window.frameElement?.getBoundingClientRect();
  const point = { x: x + (frame?.left ?? 0), y: y + (frame?.top ?? 0) };
  await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

describe("the book finder on a phone (#502)", () => {
  it("A8 a tap on a row opens the book, at 414 wide with one pane", async () => {
    await phone();
    const onOpen = vi.fn();
    await mount(onOpen);
    await expect.poll(() => rows().length).toBeGreaterThan(0);

    // Soft and by query, so a finder that ignores its books still reaches
    // every line below and says each thing it gets wrong.
    expect
      .soft(document.querySelector('[role="dialog"]')?.getAttribute("aria-label"))
      .toBe("Find book");
    // The four notes with an epub, and neither the paper beside its pdf nor a
    // note with no book.
    expect.soft(rows()).toHaveLength(4);
    const texts = rows().map((row) => row.textContent ?? "");
    expect.soft(texts.some((text) => text.includes("Attention Is All You Need"))).toBe(false);
    expect.soft(texts.some((text) => text.includes("Shopping"))).toBe(false);

    const dune = rows().find((row) => row.textContent?.includes("Dune"));
    expect.soft(dune).toBeDefined();
    // The name and its folder apart, and the name without its `.md`.
    const parts = [...(dune?.querySelectorAll("span") ?? [])].map((span) => span.textContent);
    expect.soft(parts).toEqual(["Dune", `${BOOKS}/Science Fiction`]);
    // A row a thumb can hit.
    expect.soft(dune?.getBoundingClientRect().height ?? 0).toBeGreaterThanOrEqual(44);

    if (dune) await tap(dune);
    // The note's path, which is what the book pane takes, once.
    await expect.poll(() => onOpen.mock.calls).toEqual([[DUNE]]);
    // One column and no note read: a phone has no pane for a preview, and a
    // book has none anywhere.
    expect.soft(document.querySelector('[data-testid="preview"]')).toBeNull();
    expect.soft(fetchNote).not.toHaveBeenCalled();
  });

  it("A10 shows each book's name whole beside a long folder, at 414 wide", async () => {
    // The folder runs from the vault's root, 36 characters and more, so a row
    // that shared its width out between the two would clip the name, which is
    // what the row is read for.
    await phone();
    await mount(() => {});
    await expect.poll(() => rows().length).toBeGreaterThan(0);

    for (const book of ["Dune", "Hyperion", "Meditations", "Thinking, Fast and Slow"]) {
      const name = [...document.querySelectorAll<HTMLElement>('[role="option"] span')].find(
        (span) => span.textContent === book,
      );
      expect.soft(name, book).toBeDefined();
      expect.soft(name?.scrollWidth ?? 1, book).toBeLessThanOrEqual(name?.clientWidth ?? 0);
    }
  });

  it("scrolls a shelf of forty books inside the panel, at phone and at desktop width", async () => {
    // Every book is listed, so a long shelf is longer than the panel, and the
    // list has to scroll inside it rather than run off the bottom of the window.
    const notes = Array.from({ length: 40 }, (_, index) => `${BOOKS}/Book ${index}.md`);
    const epubs = notes.map((note) => note.replace(/\.md$/, ".epub"));
    for (const [width, height] of [
      [414, 896],
      [1280, 900],
    ] as const) {
      await page.viewport(width, height);
      await mount(() => {}, notes, epubs);
      await expect.poll(() => rows().length).toBeGreaterThan(0);

      const list = document.querySelector<HTMLElement>('[role="listbox"]');
      expect.soft(rows(), `${width}`).toHaveLength(40);
      expect.soft(list?.scrollHeight ?? 0, `${width}`).toBeGreaterThan(list?.clientHeight ?? 0);
      expect
        .soft(list?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY, `${width}`)
        .toBeLessThanOrEqual(height);
      await act(async () => root?.unmount());
      host?.remove();
      root = undefined;
      host = undefined;
    }
  });

  it("draws its rows with names and folders at phone and at desktop width", async () => {
    // The desktop at the 1280 the runner's window holds, past which the frame
    // shrinks and the picture with it. The phone with its finger, so the rows
    // are the height a thumb gets.
    for (const [name, width, height, touch] of [
      ["phone", 414, 896, true],
      ["desktop", 1280, 900, false],
    ] as const) {
      await page.viewport(width, height);
      await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: 5 });
      await mount(() => {});
      await expect.poll(() => rows().length).toBe(4);
      expect(await shot(host as Element, `book-finder-${name}`)).toBe(width);
      await act(async () => root?.unmount());
      host?.remove();
      root = undefined;
      host = undefined;
    }
  });
});
