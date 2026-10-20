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

import { backImages } from "@/lib/book-backing";
import {
  additions,
  chapterOne,
  computed,
  keepMounted,
  loaded,
  type Mounted,
  png,
  sections,
  TRANSPARENT,
  WHITE,
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

  it("decides a glyph in a hidden block again once it shows", async () => {
    // Hidden, it lays out at nothing, which reads as no line of text (#481).
    const doc = await chapterOne();
    await additions(doc);
    expect((doc.querySelector("#hidden") as HTMLElement).getBoundingClientRect().height).toBe(0);

    (doc.querySelector("#more") as HTMLElement).hidden = false;

    await vi.waitFor(() => expect(computed(doc, "#hidden", "filter")).toBe("invert(1)"), {
      timeout: 5_000,
    });
    expect(computed(doc, "#hidden", "backgroundColor")).toBe(TRANSPARENT);
  }, 30_000);

  it("decides a glyph in a span again when its paragraph's font grows past it", async () => {
    // 20px is over 1.5em of 12px text and within 1.5em of 16px. The span round
    // it is inline, which an observer reports as 0x0 whatever its font, so only
    // the paragraph's box tells (#481). Lines of text after the glyph's, since
    // the glyph's own line keeps the height the glyph gives it.
    const doc = await chapterOne();
    const glyph = doc.createElement("img");
    glyph.id = "spanned";
    glyph.alt = "*";
    glyph.src = png(20, 20);
    glyph.style.cssText = "width: 20px; height: 20px;";
    const span = doc.createElement("span");
    span.append(glyph);
    const paragraph = doc.createElement("p");
    paragraph.style.fontSize = "12px";
    paragraph.append("A glyph ", span, " in a span.", " And a sentence after it.".repeat(20));
    (doc.querySelector("#ornate") as HTMLElement).after(paragraph);
    backImages(doc);
    await loaded(doc, "#spanned");
    await vi.waitFor(() => expect(computed(doc, "#spanned", "backgroundColor")).toBe(WHITE), {
      timeout: 5_000,
    });

    paragraph.style.fontSize = "16px";

    await vi.waitFor(() => expect(computed(doc, "#spanned", "filter")).toBe("invert(1)"), {
      timeout: 5_000,
    });
    expect(computed(doc, "#spanned", "backgroundColor")).toBe(TRANSPARENT);
  }, 30_000);

  it("draws a small svg glyph light on the dark page, with no white patch", async () => {
    // Drawn through an `<image>`, like a calibre cover, but the size of a
    // letter, so it is inverted like the ornament beside it (#483).
    const doc = await chapterOne();
    await additions(doc);

    await vi.waitFor(() => expect(computed(doc, "#glyph", "filter")).toBe("invert(1)"), {
      timeout: 5_000,
    });
    expect(computed(doc, "#glyph", "backgroundColor")).toBe(TRANSPARENT);
  }, 30_000);
});
