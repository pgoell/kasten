import type { Root } from "react-dom/client";
import { BACKING, backImages, treatmentFor } from "@/lib/book/book-backing";
import { computed, drawDark, located, sections, trackMounted } from "./book-pane-fixture";

const { fetchBook, fetchNote } = vi.hoisted(() => ({ fetchBook: vi.fn(), fetchNote: vi.fn() }));
// `fetchImages`, `fetchHtml`, `fetchAssets`, `uploadAsset` and `fetchTranscript` are here because the module is replaced whole:
// the route and the editor import them, and a factory short of a name breaks the
// import rather than the call.
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

let mounted: { root: Root; container: HTMLElement } | null = null;
trackMounted((next) => {
  mounted = next;
});

/** Wait for one element's background to be white. */
function white(doc: Document, selector: string): Promise<void> {
  return vi.waitFor(
    () => expect(computed(doc, selector, "backgroundColor"), selector).toBe("rgb(255, 255, 255)"),
    { timeout: 10_000 },
  );
}

describe("the reader over a real book", () => {
  beforeEach(() => {
    located.length = 0;
    sections.length = 0;
  });

  afterEach(() => {
    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
    vi.unstubAllGlobals();
  });

  it("draws black line art on a transparent png on a white page of its own", async () => {
    // The book's white sits on the figure, and the figure goes transparent with
    // every other block, so the white has to come back on the image (#469).
    const { doc } = await drawDark();

    await white(doc, "#art");
  }, 30_000);

  it("leaves the dark page round an opaque image", async () => {
    // An opaque picture covers any white behind it, so it gets none (#475).
    // Asked once `#art` is decided, so the answer is not the one before any.
    const { doc } = await drawDark();
    await white(doc, "#art");

    expect(computed(doc, "#pic", "backgroundColor")).toBe("rgba(0, 0, 0, 0)");
  }, 30_000);

  it("draws an inline svg on white, with its text in black", async () => {
    // An svg's text fills black whatever the colour, so on the dark page it
    // needs the white page it was drawn for (#471).
    const { doc } = await drawDark();

    expect(computed(doc, "#svg", "backgroundColor")).toBe("rgb(255, 255, 255)");
    expect(computed(doc, "#svgtext", "fill")).toBe("rgb(0, 0, 0)");
  }, 30_000);

  it("fills an svg shape drawn in currentColor in black", async () => {
    const { doc } = await drawDark();

    expect(computed(doc, "#svgrect", "fill")).toBe("rgb(0, 0, 0)");
  }, 30_000);

  it("keeps the white page under an image another origin keeps from being read", async () => {
    // A tainted canvas throws from the chapter's own window, whose DOMException
    // is not the app's. A real cross-origin image cannot stand in here: the
    // page's `img-src` refuses another origin over http, so it never loads and
    // takes the broken image's white without reaching the read.
    const { doc } = await drawDark();
    const Chapter = (doc.defaultView as Window & typeof globalThis).DOMException;
    const tainted = () => {
      throw new Chapter("tainted", "SecurityError");
    };

    expect(await treatmentFor(doc.querySelector("#art") as HTMLImageElement, tainted)).toBe(
      "white",
    );
  }, 30_000);

  it("keeps the white page under line art the book fits with object-fit contain", async () => {
    // Publishers write `img { max-width: 100%; object-fit: contain }`, which at
    // the picture's own shape draws no bars, so the line art keeps its white.
    const { doc } = await drawDark();
    const img = doc.createElement("img");
    img.src = (doc.querySelector("#art") as HTMLImageElement).src;
    img.style.cssText = "max-width: 100%; object-fit: contain;";
    doc.body.append(img);

    expect(await treatmentFor(img)).toBe("white");
  }, 30_000);

  it("keeps the white page under line art letterboxed in a chapter with text", async () => {
    // `img { width: 100% }` and foliate's `max-height` make a tall diagram's
    // box wider than its picture. Bars beside it beat a diagram nobody can read.
    const { doc } = await drawDark();
    const img = doc.createElement("img");
    img.src = (doc.querySelector("#art") as HTMLImageElement).src;
    img.style.cssText = "width: 100%; height: 40px; object-fit: contain;";
    doc.body.append(img);

    expect(await treatmentFor(img)).toBe("white");
  }, 30_000);

  it("decides images added to a section after it loaded", async () => {
    const { doc } = await drawDark();
    const opaque = doc.createElement("img");
    opaque.src = (doc.querySelector("#pic") as HTMLImageElement).src;
    const transparent = doc.createElement("img");
    transparent.src = (doc.querySelector("#art") as HTMLImageElement).src;
    doc.body.append(opaque, transparent);

    backImages(doc);

    await vi.waitFor(
      () => {
        expect(transparent.hasAttribute(BACKING)).toBe(true);
        expect(opaque.naturalWidth).toBeGreaterThan(0);
      },
      { timeout: 10_000 },
    );
    expect((doc.defaultView as Window).getComputedStyle(transparent).backgroundColor).toBe(
      "rgb(255, 255, 255)",
    );
    expect((doc.defaultView as Window).getComputedStyle(opaque).backgroundColor).toBe(
      "rgba(0, 0, 0, 0)",
    );
  }, 30_000);

  it("keeps the white page under an image inside a link", async () => {
    const { doc } = await drawDark();

    await white(doc, "#linkpic");
  }, 30_000);

  it("writes an image's alt text in black on its white page", async () => {
    // A broken image draws its alt text, and an object its fallback, in the
    // element's own colour, which on the white would be the theme's pale text.
    const { doc } = await drawDark();

    for (const selector of ["#art", "#linkpic", "#obj"])
      expect(computed(doc, selector, "color"), selector).toBe("rgb(0, 0, 0)");
  }, 30_000);

  it("leaves the dark page round an svg cover", async () => {
    // A cover page fits a raster into an svg the size of the page, and the
    // bars either side of the picture are page, not art. Larger than a line of
    // text, so not a glyph to invert either (#483).
    const { doc } = await drawDark();
    // Once the line art has its white, the section's images are decided.
    await white(doc, "#art");

    expect(computed(doc, "#cover", "backgroundColor")).toBe("rgba(0, 0, 0, 0)");
    expect(computed(doc, "#cover", "filter")).toBe("none");
  }, 30_000);

  it("draws an object and a picture on white", async () => {
    const { doc } = await drawDark();

    for (const selector of ["#obj", "#picture", "#picture img"]) await white(doc, selector);
  }, 30_000);
});
