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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { page } from "vitest/browser";
import { BookPane } from "@/components/book-pane";
import { BACKING, backImages, INK, treatmentFor } from "@/lib/book-backing";
// A book written for a white page, `body { color: #000; background: #fff }`,
// with a cover page first and two chapters after it. The cover page holds only
// `#cover`, `cover.png`, an opaque 300x450 portrait gradient fitted to the page
// with `width: 100%; height: 100%; object-fit: contain`, so its box is the
// page's shape and the picture letterboxes inside it. Chapter one (`One`) holds
// an h1, paragraphs of text, `#ornament` inline in `#ornate` (`ornament.png`, a
// 16x16 black circle on transparent, the size of the text round it), `#art`
// (`art.png`, the 64x64 black lines on transparent from `dark-text.epub`) and
// `#photo` (`photo.png`, an opaque 200x120 plasma). Chapter two (`Two`) holds a
// paragraph and `#photo2`, the same opaque png, for the case after a turn.
import coverUrl from "../fixtures/cover.epub?url";
import { stubCommands } from "../stub-commands";
import { shot } from "./shots";
// The app's own stylesheet, because the pane is sized by Tailwind's `h-full`
// and a paginator with nothing to columnise into draws no page.
import "@/styles/app.css";

const NOTE = "20 Literature/Cover.md";

/** The top of chapter one, the second `itemref`, which skips the cover page. */
const CHAPTER_ONE = "epubcfi(/6/4!/4/2/1:0)";

const TRANSPARENT = "rgba(0, 0, 0, 0)";
const WHITE = "rgb(255, 255, 255)";

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

/** Every section document foliate reported, which is the only way inside. */
const sections: Document[] = [];

// In the capture phase and before anything mounts, because `view.init()`
// loads the first section during mount.
document.addEventListener(
  "load",
  (event) => {
    const { doc } = (event as CustomEvent<{ doc?: Document }>).detail ?? {};
    if (doc) sections.push(doc);
  },
  true,
);

/** Wait for the rest of `draw` to run, which the `load` event is in the middle of. */
function drawn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

/** One property of one element of a section, as the section computes it. */
function computed(doc: Document, selector: string, property: "backgroundColor" | "filter"): string {
  const element = doc.querySelector(selector);
  if (!element) throw new Error(`nothing at ${selector} inside the book`);
  return (doc.defaultView as Window).getComputedStyle(element)[property];
}

/** An image of a section, once its pixels have arrived. */
async function loaded(doc: Document, selector: string): Promise<HTMLImageElement> {
  const image = doc.querySelector(selector) as HTMLImageElement;
  await vi.waitFor(
    () => {
      expect(image.complete).toBe(true);
      expect(image.naturalWidth).toBeGreaterThan(0);
    },
    { timeout: 10_000 },
  );
  return image;
}

/** The section foliate loaded last, once it is the one titled `title`. */
async function section(title: string): Promise<Document> {
  await vi.waitFor(() => expect(sections.at(-1)?.title).toBe(title), { timeout: 10_000 });
  await drawn();
  return sections.at(-1) as Document;
}

/** Turn pages until the section titled `title` is the one drawn. */
async function turnTo(container: HTMLElement, title: string): Promise<Document> {
  const view = container.querySelector("foliate-view") as HTMLElement & {
    next: () => Promise<void>;
  };
  // A turn the paginator's lock drops is simply tried again.
  await vi.waitFor(
    async () => {
      await view.next();
      expect(sections.at(-1)?.title).toBe(title);
    },
    { timeout: 15_000, interval: 200 },
  );
  await drawn();
  return sections.at(-1) as Document;
}

let mounted: { root: Root; container: HTMLElement } | null = null;

/** Mount the reader over the fixture, at `reading` if given, in a pane `width` wide. */
async function drawBook(reading = "", width = 600): Promise<HTMLElement> {
  fetchBook.mockResolvedValue({
    path: NOTE.replace(/\.md$/, ".epub"),
    blob: await (await fetch(coverUrl)).blob(),
  });
  fetchNote.mockResolvedValue(reading ? `---\nid: one\nreading: ${reading}\n---\n# Cover\n` : "");
  const container = document.createElement("div");
  container.style.cssText = `width: ${width}px; height: 700px;`;
  document.body.append(container);

  const root = createRoot(container);
  mounted = { root, container };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  root.render(
    <QueryClientProvider client={client}>
      <BookPane
        note={NOTE}
        paths={[NOTE]}
        commands={stubCommands()}
        focusSignal={0}
        onFocus={() => {}}
        onMoved={() => {}}
        onLeaving={() => {}}
        onTake={() => {}}
        onNotice={() => {}}
      />
    </QueryClientProvider>,
  );
  return container;
}

/**
 * Chapter one, drawn, once the line art has its white.
 *
 * The backing lands after an image loads, so the white under `#art` is the sign
 * that the section's images have been looked at. Asserting that another image
 * has none before then would pass on a page nothing has looked at yet.
 */
async function chapterOne(): Promise<Document> {
  await drawBook(CHAPTER_ONE);
  const doc = await section("One");
  await loaded(doc, "#art");
  await vi.waitFor(() => expect(computed(doc, "#art", "backgroundColor")).toBe(WHITE), {
    timeout: 10_000,
  });
  return doc;
}

/**
 * A 16px red circle on transparent, set into `#ornate` beside the ornament and
 * decided, its verdict landed.
 *
 * The fixture holds no coloured icon, so one is drawn here.
 */
async function redIcon(doc: Document): Promise<HTMLImageElement> {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.fillStyle = "red";
  context.arc(8, 8, 7, 0, 2 * Math.PI);
  context.fill();
  const icon = doc.createElement("img");
  icon.id = "icon";
  icon.alt = "!";
  icon.src = canvas.toDataURL();
  icon.style.cssText = "width: 16px; height: 16px;";
  (doc.querySelector("#ornate") as HTMLElement).append(" and an icon ", icon);

  backImages(doc);
  // The same decision `backImages` waits on, so the attributes have landed after it.
  expect(await treatmentFor(icon)).toBe("plain");
  return icon;
}

/** A png of `width` by `height` as a data URL, with a black bar across a clear ground, or all clear. */
function png(width: number, height: number, bar = true): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  if (bar) (canvas.getContext("2d") as CanvasRenderingContext2D).fillRect(0, 10, width, 10);
  return canvas.toDataURL();
}

/**
 * Set the shapes #481 to #483 are about into chapter one, decided and loaded.
 *
 * After `#ornate` come `#strip`, an 800x48 black bar on transparent under
 * `max-width: 100%`, which is taller than 1.5em of the 16px text only in a
 * wide page's column, about 470px against a phone's 330; `#spacer`,
 * a transparent 1x1 stretched 40px tall; and `#more`, a `hidden` div holding
 * `#hidden`, the ornament at 16px. Not a closed `<details>`: Chromium hides
 * its content with `content-visibility` and still lays it out, at its own
 * size, where `display: none` lays it out at nothing. Into `#ornate` goes `#glyph`, a 1em
 * svg drawing the ornament through an `<image>`.
 */
async function additions(doc: Document): Promise<void> {
  const ornament = (doc.querySelector("#ornament") as HTMLImageElement).src;
  const paragraph = (...children: Node[]) => {
    const p = doc.createElement("p");
    p.append(...children);
    return p;
  };
  const strip = doc.createElement("img");
  strip.id = "strip";
  strip.alt = "";
  strip.src = png(800, 48);
  strip.style.cssText = "max-width: 100%;";
  const spacer = doc.createElement("img");
  spacer.id = "spacer";
  spacer.alt = "";
  spacer.src = png(1, 1, false);
  spacer.style.cssText = "width: 100%; height: 40px;";
  const hidden = doc.createElement("img");
  hidden.id = "hidden";
  hidden.alt = "*";
  hidden.src = ornament;
  hidden.style.cssText = "width: 16px; height: 16px;";
  const more = doc.createElement("div");
  more.id = "more";
  more.hidden = true;
  more.append(paragraph(doc.createTextNode("A glyph "), hidden));
  const ornate = doc.querySelector("#ornate") as HTMLElement;
  ornate.after(paragraph(strip), paragraph(spacer), more);

  const glyph = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  glyph.id = "glyph";
  glyph.setAttribute("width", "1em");
  glyph.setAttribute("height", "1em");
  const image = doc.createElementNS("http://www.w3.org/2000/svg", "image");
  image.setAttribute("href", ornament);
  image.setAttribute("width", "100%");
  image.setAttribute("height", "100%");
  glyph.append(image);
  ornate.append(" and a glyph ", glyph);

  backImages(doc);
  for (const selector of ["#strip", "#spacer", "#hidden"]) await loaded(doc, selector);
  await drawn();
}

/** Put the page and the pane at `width`, so the paginator lays the chapter out again. */
async function widen(width: number): Promise<void> {
  await page.viewport(width, 800);
  const container = mounted?.container as HTMLElement;
  container.style.cssText = `width: ${width}px; height: 700px;`;
  await drawn();
}

/** Wait for `#strip` to be on white at a wide page and inverted at a narrow one. */
function stripAt(doc: Document, width: number): Promise<void> {
  const wide = width > 600;
  return vi.waitFor(
    () => {
      expect(computed(doc, "#strip", "backgroundColor")).toBe(wide ? WHITE : TRANSPARENT);
      expect(computed(doc, "#strip", "filter")).toBe(wide ? "none" : "invert(1)");
    },
    { timeout: 5_000 },
  );
}

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

  it("gives an opaque image no white page", async () => {
    const doc = await chapterOne();
    await loaded(doc, "#photo");

    await vi.waitFor(() => expect(computed(doc, "#photo", "backgroundColor")).toBe(TRANSPARENT), {
      timeout: 5_000,
    });
  }, 30_000);

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
