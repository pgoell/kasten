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

import { BACKING, INK } from "@/lib/book-backing";
import {
  chapterOne,
  clearPage,
  computed,
  darkPage,
  keepMounted,
  loaded,
  type Mounted,
  redIcon,
  sections,
  TRANSPARENT,
} from "./book-cover-fixture";

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

  it("draws a small black ornament light on the dark page, with no white patch", async () => {
    // Black on the dark page it would all but vanish, and white round it would
    // box it out of its line, so it is inverted (#478).
    const doc = await chapterOne();
    await loaded(doc, "#ornament");

    await vi.waitFor(() => expect(computed(doc, "#ornament", "filter")).toBe("invert(1)"), {
      timeout: 5_000,
    });
    expect(computed(doc, "#ornament", "backgroundColor")).toBe(TRANSPARENT);
  }, 30_000);

  it("leaves a small coloured icon as it is, neither inverted nor on white", async () => {
    const doc = await chapterOne();
    const icon = await redIcon(doc);

    expect(icon.hasAttribute(INK)).toBe(false);
    expect(icon.hasAttribute(BACKING)).toBe(false);
    expect(computed(doc, "#icon", "filter")).toBe("none");
    expect(computed(doc, "#icon", "backgroundColor")).toBe(TRANSPARENT);
  }, 30_000);
});
