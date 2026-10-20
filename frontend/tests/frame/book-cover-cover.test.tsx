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
import { BACKING, backImages, treatmentFor } from "@/lib/book-backing";
import {
  computed,
  drawBook,
  drawn,
  keepMounted,
  loaded,
  type Mounted,
  section,
  sections,
  TRANSPARENT,
} from "./book-cover-fixture";

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
  });

  afterEach(() => {
    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
  });

  it("leaves the dark page round a letterboxed cover img", async () => {
    // In a `finally`, so a failure does not leave its window to the cases after it.
    try {
      await page.viewport(1200, 800);
      await drawBook("", 1200);
      const doc = await section("Cover");
      const cover = await loaded(doc, "#cover");
      // No transparent image on this page to signal that it was looked at, so
      // the backing gets a moment to land after the pixels have.
      await drawn();

      // The box and the picture are not the same shape, so there are bars to see.
      const box = cover.getBoundingClientRect();
      expect(
        Math.abs(box.width / box.height - cover.naturalWidth / cover.naturalHeight),
      ).toBeGreaterThan(0.05);
      await vi.waitFor(() => expect(computed(doc, "#cover", "backgroundColor")).toBe(TRANSPARENT), {
        timeout: 5_000,
      });
    } finally {
      await page.viewport(414, 896);
    }
  }, 30_000);

  it("leaves the dark page round a letterboxed cover with transparent pixels", async () => {
    // The bars decide it, not the pixels: a square of transparent line art
    // stretched to the page's box would put its white across the whole page.
    try {
      await page.viewport(1200, 800);
      await drawBook("", 1200);
      const doc = await section("Cover");
      // The cover page holds no transparent png, so one is drawn here: a black
      // line across a square of nothing.
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      (canvas.getContext("2d") as CanvasRenderingContext2D).fillRect(0, 30, 64, 4);
      const art = doc.createElement("img");
      art.src = canvas.toDataURL();
      art.style.cssText = "width: 100%; height: 100%; object-fit: contain;";
      doc.body.append(art);

      backImages(doc);
      // The same decision `backImages` waits on, so the attribute has landed after it.
      expect(await treatmentFor(art)).toBe("plain");

      const box = art.getBoundingClientRect();
      expect(Math.abs(box.width / box.height - 1)).toBeGreaterThan(0.05);
      expect(art.hasAttribute(BACKING)).toBe(false);
      expect((doc.defaultView as Window).getComputedStyle(art).backgroundColor).toBe(TRANSPARENT);
    } finally {
      await page.viewport(414, 896);
    }
  }, 30_000);
});
