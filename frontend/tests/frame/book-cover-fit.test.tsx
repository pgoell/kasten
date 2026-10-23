/**
 * A section that is only a picture fits the pane's height, whole, in real
 * Chromium (#902). A flowing book has no height of its own, so foliate's image
 * sizing gives a cover nothing to clamp to and it runs off the foot of the pane.
 * These check the cover against the renderer's visible area: at 1440 and on a
 * 414 phone, light and dark, when the pane changes height, and in each pane of
 * a split. A chapter with text keeps its pictures as the book drew them.
 */

import "./html-take-api";
import { page } from "vitest/browser";
import type { FoliateView } from "@/lib/foliate-view";
import { THEME_KEY } from "@/lib/theme";
import coverUrl from "../fixtures/cover.epub?url";
import {
  chapterOne,
  clearPage,
  darkPage,
  drawBook,
  keepMounted,
  loaded,
  type Mounted,
  section,
  sections,
} from "./book-cover-fixture";
import { located, sections as paneSections } from "./book-pane-fixture";
import { mountBooks, paneOf, sectionOf } from "./book-take-fixture";
import { type Mounted as Split, setUp, tearDown } from "./html-take-fixture";

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

const LEFT = "20 Literature/Left.md";
const RIGHT = "20 Literature/Right.md";
/** The gap the paginator leaves above and below a section, its `--_margin` default. */
const MARGIN = 48;

let mounted: Mounted | null = null;
keepMounted({
  get: () => mounted,
  set: (next) => {
    mounted = next;
  },
});

/**
 * The cover's box and the visible area of its pane, in the app's own coordinates.
 *
 * The height the cover should draw at is the pane's, or the cover's own at its
 * width when that is less: on a narrow pane the width sets the height and the
 * picture was never taller than the pane.
 */
function fitOf(pane: HTMLElement, doc: Document, cover: HTMLImageElement) {
  const renderer = (pane.querySelector("foliate-view") as FoliateView).renderer as HTMLElement;
  const area = renderer.getBoundingClientRect();
  const box = cover.getBoundingClientRect();
  const frame = (doc.defaultView as Window).frameElement as Element;
  const own = (box.width * cover.naturalHeight) / cover.naturalWidth;
  return {
    height: box.height,
    fit: Math.min(area.height - MARGIN * 2, own),
    // What the product wrote, which is the pane's fit whatever the width gives.
    written: Number.parseFloat(cover.style.maxHeight),
    paneFit: area.height - MARGIN * 2,
    bottom: frame.getBoundingClientRect().top + box.bottom,
    limit: area.bottom - MARGIN,
  };
}

/**
 * Wait until the cover is drawn at its pane's fit, or give up at the bound, so the
 * checks after it still run and a red run reports every one that failed.
 */
async function settle(pane: HTMLElement, doc: Document, cover: HTMLImageElement): Promise<void> {
  await vi
    .waitFor(
      () => {
        const { height, fit } = fitOf(pane, doc, cover);
        expect(height).toBeCloseTo(fit, 0);
      },
      { timeout: 5_000 },
    )
    .catch(() => undefined);
}

/**
 * The product wrote the pane's fit as the cover's max-height, the cover is drawn at its
 * fit, and its bottom sits above the lower margin.
 */
function expectFitted(pane: HTMLElement, doc: Document, cover: HTMLImageElement): void {
  const { height, fit, written, paneFit, bottom, limit } = fitOf(pane, doc, cover);
  expect.soft(written).toBeCloseTo(paneFit, 0);
  expect.soft(height).toBeCloseTo(fit, 0);
  expect.soft(bottom).toBeLessThanOrEqual(limit + 1);
}

describe("a cover-only section fits the pane's height", () => {
  beforeEach(() => {
    sections.length = 0;
  });

  afterEach(() => {
    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
  });

  it("fits a cover to the pane's height, whole, at 1440 in the dark", async () => {
    try {
      await page.viewport(1440, 900);
      darkPage();
      const container = await drawBook("", 1440);
      const doc = await section("Cover");
      const cover = await loaded(doc, "#cover");
      await settle(container, doc, cover);
      expectFitted(container, doc, cover);
    } finally {
      clearPage();
      await page.viewport(1440, 900);
    }
  }, 30_000);

  it("fits a cover to the pane's height, whole, on a 414 phone in the light", async () => {
    try {
      await page.viewport(414, 896);
      localStorage.setItem(THEME_KEY, "light");
      const container = await drawBook("", 414);
      const doc = await section("Cover");
      const cover = await loaded(doc, "#cover");
      await settle(container, doc, cover);
      expectFitted(container, doc, cover);
    } finally {
      clearPage();
      await page.viewport(1440, 900);
    }
  }, 30_000);

  it("fits a cover to the pane's height, whole, on a 414 phone in the dark", async () => {
    try {
      await page.viewport(414, 896);
      darkPage();
      const container = await drawBook("", 414);
      const doc = await section("Cover");
      const cover = await loaded(doc, "#cover");
      await settle(container, doc, cover);
      expectFitted(container, doc, cover);
    } finally {
      clearPage();
      await page.viewport(1440, 900);
    }
  }, 30_000);

  it("refits a cover when the pane's height changes", async () => {
    try {
      await page.viewport(1440, 900);
      const container = await drawBook("", 1440);
      const doc = await section("Cover");
      const cover = await loaded(doc, "#cover");
      await settle(container, doc, cover);
      expectFitted(container, doc, cover);

      container.style.cssText = "width: 1440px; height: 500px;";
      await settle(container, doc, cover);
      expectFitted(container, doc, cover);
    } finally {
      await page.viewport(1440, 900);
    }
  }, 30_000);

  it("fits each pane of a split to its own cover", async () => {
    const split: Split = await setUp();
    try {
      located.length = 0;
      paneSections.length = 0;
      const blob = await (await fetch(coverUrl)).blob();
      fetchBook.mockImplementation(async (note: string) => ({
        path: note.replace(/\.md$/, ".epub"),
        blob,
      }));
      fetchNote.mockResolvedValue("");
      mountBooks(split, [LEFT, RIGHT]);

      for (const note of [LEFT, RIGHT]) {
        const pane = paneOf(split, note);
        const doc = await sectionOf(note);
        const cover = await loaded(doc, "#cover");
        await settle(pane, doc, cover);
        expectFitted(pane, doc, cover);
      }
    } finally {
      await tearDown(split);
    }
  }, 30_000);

  it("leaves the pictures of a chapter with text as the book drew them", async () => {
    try {
      await page.viewport(1440, 900);
      const doc = await chapterOne();
      await loaded(doc, "#photo");
      // A fit on a page with text would clamp these to the pane, which only a cover is for.
      expect(
        (doc.querySelector("#photo") as HTMLElement).style.getPropertyValue("max-height"),
      ).toBe("");
      expect((doc.querySelector("#art") as HTMLElement).style.getPropertyValue("max-height")).toBe(
        "",
      );
    } finally {
      await page.viewport(1440, 900);
    }
  }, 30_000);
});
