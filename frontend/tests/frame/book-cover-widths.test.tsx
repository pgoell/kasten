/**
 * Which images the reader draws on a white page of their own, in real Chromium
 * (#475).
 *
 * The white is there for black line art on a transparent png (#469), and it
 * belongs to the img's box. A cover fitted to the page with `object-fit:
 * contain` has a box the shape of the page and not of the picture, so a white
 * box draws white bars either side of it. Whether a box is letterboxed, how big
 * it renders and whether its pixels are transparent are all things only a real
 * layout and a real decoder answer.
 */

import { page } from "vitest/browser";
import {
  chapterOne,
  clearPage,
  computed,
  darkPage,
  drawBook,
  drawn,
  keepMounted,
  loaded,
  type Mounted,
  redIcon,
  section,
  sections,
  turnTo,
} from "./book-cover-fixture";
import { shot } from "./shots";

const { fetchBook, fetchNote } = vi.hoisted(() => ({ fetchBook: vi.fn(), fetchNote: vi.fn() }));
// The module is replaced whole, so every name the route and the editor import
// from it has to be here or the import breaks.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchBook,
  fetchNote,
  fetchImages: () => Promise.resolve([]),
  fetchHtml: () => Promise.resolve([]),
  fetchAssets: () => Promise.resolve([]),
  uploadAsset: () => Promise.resolve(),
  fetchTranscript: () => Promise.resolve(),
}));

let mounted: Mounted | null = null;
keepMounted({
  get: () => mounted,
  set: (next) => {
    mounted = next;
  },
});

describe("the white page under a book's images", () => {
  beforeEach(() => {
    sections.length = 0;
    darkPage();
  });

  afterEach(() => {
    clearPage();
    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
  });

  it("draws the cover and a chapter at phone and at desktop width", async () => {
    const container = await drawBook();
    const pane = () => container.querySelector("[data-book-pane]") as HTMLElement;
    const widths = [
      ["phone", 390],
      ["desktop", 1200],
    ] as const;
    try {
      const cover = await section("Cover");
      await loaded(cover, "#cover");
      for (const [name, width] of widths) {
        await page.viewport(width, 800);
        container.style.cssText = `width: ${width}px; height: 700px;`;
        await drawn();
        expect(await shot(pane(), `book-cover-${name}`)).toBe(width);
      }

      const chapter = await turnTo(container, "One");
      for (const selector of ["#art", "#photo", "#ornament"]) await loaded(chapter, selector);
      for (const [name, width] of widths) {
        await page.viewport(width, 800);
        container.style.cssText = `width: ${width}px; height: 700px;`;
        await drawn();
        expect(await shot(pane(), `book-chapter-${name}`)).toBe(width);
      }
    } finally {
      await page.viewport(414, 896);
    }
  }, 60_000);

  it("draws the ornament and a coloured icon at phone and at desktop width", async () => {
    try {
      const doc = await chapterOne();
      await loaded(doc, "#ornament");
      await redIcon(doc);
      await vi.waitFor(() => expect(computed(doc, "#ornament", "filter")).toBe("invert(1)"), {
        timeout: 5_000,
      });
      const container = mounted?.container as HTMLElement;
      const pane = container.querySelector("[data-book-pane]") as HTMLElement;
      for (const [name, width] of [
        ["phone", 390],
        ["desktop", 1200],
      ] as const) {
        await page.viewport(width, 800);
        container.style.cssText = `width: ${width}px; height: 700px;`;
        await drawn();
        expect(await shot(pane, `book-ornament-${name}`)).toBe(width);
      }
    } finally {
      await page.viewport(414, 896);
    }
  }, 60_000);
});
