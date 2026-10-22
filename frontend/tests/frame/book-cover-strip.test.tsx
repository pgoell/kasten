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
  additions,
  chapterOne,
  clearPage,
  computed,
  darkPage,
  keepMounted,
  type Mounted,
  sections,
  stripAt,
  TRANSPARENT,
  widen,
} from "./book-cover-fixture";
import { shot } from "./shots";

const { fetchBook, fetchNote } = vi.hoisted(() => ({ fetchBook: vi.fn(), fetchNote: vi.fn() }));
// The module is replaced whole, so every name the route and the editor import
// from it has to be here or the import breaks.
vi.mock("@/lib/api", () => ({
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

  it("decides a wide strip again as the page narrows and widens", async () => {
    // Over 1.5em tall on a wide page, under it on a phone's, so white and then
    // inverted, and white again (#481).
    try {
      const doc = await chapterOne();
      await additions(doc);
      for (const width of [1200, 390, 1200]) {
        await widen(width);
        await stripAt(doc, width);
      }
    } finally {
      await page.viewport(414, 896);
    }
  }, 60_000);

  it("draws a wide strip, a spacer and an svg glyph at phone and at desktop width", async () => {
    try {
      const doc = await chapterOne();
      await additions(doc);
      const container = mounted?.container as HTMLElement;
      const pane = container.querySelector("[data-book-pane]") as HTMLElement;
      for (const [name, width] of [
        ["phone", 390],
        ["desktop", 1200],
      ] as const) {
        await widen(width);
        await stripAt(doc, width);
        expect(computed(doc, "#spacer", "backgroundColor")).toBe(TRANSPARENT);
        expect(computed(doc, "#glyph", "filter")).toBe("invert(1)");
        expect(await shot(pane, `book-resize-${name}`)).toBe(width);
      }
    } finally {
      await page.viewport(414, 896);
    }
  }, 60_000);
});
