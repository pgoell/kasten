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
function computed(doc: Document, selector: string, property: "backgroundColor"): string {
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

  it("gives an opaque image no white page", async () => {
    const doc = await chapterOne();
    await loaded(doc, "#photo");

    await vi.waitFor(() => expect(computed(doc, "#photo", "backgroundColor")).toBe(TRANSPARENT), {
      timeout: 5_000,
    });
  }, 30_000);

  it("gives a small inline ornament no white patch", async () => {
    const doc = await chapterOne();
    await loaded(doc, "#ornament");

    await vi.waitFor(
      () => expect(computed(doc, "#ornament", "backgroundColor")).toBe(TRANSPARENT),
      { timeout: 5_000 },
    );
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
});
