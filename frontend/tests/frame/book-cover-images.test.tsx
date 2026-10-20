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

import {
  chapterOne,
  computed,
  drawn,
  keepMounted,
  loaded,
  type Mounted,
  sections,
  TRANSPARENT,
  turnTo,
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

  it("gives an opaque image no white page", async () => {
    const doc = await chapterOne();
    await loaded(doc, "#photo");

    await vi.waitFor(() => expect(computed(doc, "#photo", "backgroundColor")).toBe(TRANSPARENT), {
      timeout: 5_000,
    });
  }, 30_000);

  it("keeps the white page under transparent line art", async () => {
    // `chapterOne` waits for this white, so reaching the end is the claim.
    const doc = await chapterOne();

    expect(computed(doc, "#art", "backgroundColor")).toBe(WHITE);
  }, 30_000);

  it("gives an opaque image in the next chapter no white page, after a turn", async () => {
    await chapterOne();
    const doc = await turnTo(mounted?.container as HTMLElement, "Two");
    await loaded(doc, "#photo2");
    // Chapter two has no line art to signal that its images were looked at, so
    // the backing gets a moment to land after the pixels have.
    await drawn();

    await vi.waitFor(() => expect(computed(doc, "#photo2", "backgroundColor")).toBe(TRANSPARENT), {
      timeout: 5_000,
    });
  }, 40_000);
});
