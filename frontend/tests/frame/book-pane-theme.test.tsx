import type { Root } from "react-dom/client";
import { page } from "vitest/browser";
import { computed, drawDark, drawn, located, sections, trackMounted } from "./book-pane-fixture";
import { shot } from "./shots";

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

/**
 * A theme colour the way computed style spells it, `rgb(...)`.
 *
 * The variable holds a hex string and a computed colour never does, so the
 * variable goes through an element of the app's own document first.
 */
function themeColour(name: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const { color } = getComputedStyle(probe);
  probe.remove();
  return color;
}

/** Every element of `dark-text.epub` that holds text, by the colour it should take. */
const TEXT = [
  "#heading",
  "#plain",
  "#box",
  "#box p",
  "#ink",
  "#item",
  "#cell",
  "#strong",
  "#caption",
  "#anchored",
  "#chap1",
  "#anchorspan",
];
const LINKS = ["#link", "#deep", "#realpic"];
/**
 * The transparent images and the svg, each drawn on a white page of its own.
 *
 * An image's white arrives once it has loaded and its pixels are read, so a
 * case asserting it waits.
 */
const WHITE = ["#art", "#linkpic", "#svg", "#obj", "#picture", "#picture img"];
/** The svg's shapes, in the black a white page gives them. */
const INK = ["#svgtext", "#svgrect"];
/** What writes an image's alt text or an object's fallback, in black on its white. */
const ALT = ["#art", "#linkpic", "#obj"];

/** What every chapter of `dark-text.epub` should look like on the dark page. */
function expectThemed(doc: Document): void {
  const fg = themeColour("--k-ink");
  const accent = themeColour("--k-link");
  const bg = themeColour("--k-bg");
  for (const selector of TEXT) expect(computed(doc, selector, "color"), selector).toBe(fg);
  for (const selector of LINKS) expect(computed(doc, selector, "color"), selector).toBe(accent);
  for (const selector of WHITE)
    expect(computed(doc, selector, "backgroundColor"), selector).toBe("rgb(255, 255, 255)");
  for (const selector of INK)
    expect(computed(doc, selector, "fill"), selector).toBe("rgb(0, 0, 0)");
  for (const selector of ALT)
    expect(computed(doc, selector, "color"), selector).toBe("rgb(0, 0, 0)");
  expect(computed(doc, "#box", "backgroundColor")).toBe("rgba(0, 0, 0, 0)");
  expect(computed(doc, "#figure", "backgroundColor")).toBe("rgba(0, 0, 0, 0)");
  expect(computed(doc, "#cover", "backgroundColor")).toBe("rgba(0, 0, 0, 0)");
  // `pic.svg` is an opaque square, which covers any white and needs none (#475).
  expect(computed(doc, "#pic", "backgroundColor")).toBe("rgba(0, 0, 0, 0)");
  expect(computed(doc, "body", "backgroundColor")).toBe(bg);
}

/** Wait for a chapter's colours, which hold once its images are decided. */
function themed(doc: Document): Promise<void> {
  return vi.waitFor(() => expectThemed(doc), { timeout: 10_000 });
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

  it("paints a paragraph the book colours black in the theme's text", async () => {
    const { doc } = await drawDark();

    expect(computed(doc, "#plain", "color")).toBe(themeColour("--k-ink"));
  }, 30_000);

  it("paints a span, a list item and a table cell under the book's classes in the theme's text", async () => {
    const { doc } = await drawDark();
    const fg = themeColour("--k-ink");

    for (const selector of ["#ink", "#item", "#cell"])
      expect(computed(doc, selector, "color"), selector).toBe(fg);
  }, 30_000);

  it("paints a link the book gives a class colour in the theme's accent", async () => {
    const { doc } = await drawDark();

    expect(computed(doc, "#link", "color")).toBe(themeColour("--k-link"));
  }, 30_000);

  it("drops the light background the book sets on a block, and keeps the page and the image", async () => {
    const { doc } = await drawDark();
    const bg = themeColour("--k-bg");

    expect(computed(doc, "#box", "backgroundColor")).toBe("rgba(0, 0, 0, 0)");
    expect(computed(doc, "#cell", "backgroundColor")).toBe("rgba(0, 0, 0, 0)");
    expect(computed(doc, "html", "backgroundColor")).toBe(bg);
    expect(computed(doc, "body", "backgroundColor")).toBe(bg);
    const image = doc.querySelector("#pic") as HTMLImageElement;
    await vi.waitFor(() => expect(image.naturalWidth).toBeGreaterThan(0), { timeout: 10_000 });
    const box = image.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect((doc.defaultView as Window).getComputedStyle(image).visibility).toBe("visible");
  }, 30_000);

  it("paints a heading the book colours red in the theme's text", async () => {
    const { doc } = await drawDark();

    expect(computed(doc, "#heading", "color")).toBe(themeColour("--k-ink"));
  }, 30_000);

  it("beats a colour the book marks important on a class", async () => {
    const { doc } = await drawDark();

    expect(computed(doc, "#strong", "color")).toBe(themeColour("--k-ink"));
  }, 30_000);

  it("paints a dark span inside a link in the theme's accent", async () => {
    const { doc } = await drawDark();

    expect(computed(doc, "#deep", "color")).toBe(themeColour("--k-link"));
  }, 30_000);

  it("keeps the yellow the browser gives a mark", async () => {
    // The book sets nothing on it, so this is Chromium's own black on yellow,
    // which already reads on a dark page.
    const { doc } = await drawDark();

    expect(computed(doc, "#mark", "backgroundColor")).toBe("rgb(255, 255, 0)");
    expect(computed(doc, "#mark", "color")).toBe("rgb(0, 0, 0)");
  }, 30_000);

  it("drops the white the book puts behind a figure, and keeps the text around it in the theme's", async () => {
    const { doc } = await drawDark();
    const fg = themeColour("--k-ink");

    expect(computed(doc, "#figure", "backgroundColor")).toBe("rgba(0, 0, 0, 0)");
    expect(computed(doc, "#caption", "color")).toBe(fg);
    expect(computed(doc, "#plain", "color")).toBe(fg);
  }, 30_000);

  it("paints a heading inside an anchor with no href in the theme's text", async () => {
    // An `<a id>` is a place to jump to and not a link, so it takes no accent (#470).
    const { doc } = await drawDark();
    const fg = themeColour("--k-ink");

    for (const selector of ["#anchored", "#chap1"])
      expect(computed(doc, selector, "color"), selector).toBe(fg);
  }, 30_000);

  it("paints a span inside an anchor with no href in the theme's text", async () => {
    const { doc } = await drawDark();

    expect(computed(doc, "#anchorspan", "color")).toBe(themeColour("--k-ink"));
  }, 30_000);

  it("keeps the theme's colours in the next chapter, after a turn", async () => {
    const { container } = await drawDark();
    const view = container.querySelector("foliate-view") as HTMLElement & {
      next: () => Promise<void>;
    };

    // A turn the paginator's lock drops is simply tried again.
    await vi.waitFor(
      async () => {
        await view.next();
        expect(sections.at(-1)?.title).toBe("Two");
      },
      { timeout: 15_000, interval: 200 },
    );
    await drawn();

    await themed(sections.at(-1) as Document);
  }, 30_000);

  it("keeps the theme's colours at phone and at desktop width", async () => {
    const { doc, container } = await drawDark();
    // In a `finally`, so a failed width does not leave its window to the
    // cases after it.
    try {
      for (const [name, width] of [
        ["phone", 390],
        ["desktop", 1200],
      ] as const) {
        await page.viewport(width, 800);
        container.style.cssText = `width: ${width}px; height: 700px;`;
        await drawn();

        await themed(doc);
        expect(
          await shot(
            container.querySelector("[data-book-pane]") as HTMLElement,
            `book-dark-${name}`,
          ),
        ).toBe(width);
      }
    } finally {
      await page.viewport(414, 896);
    }
  }, 30_000);
});
