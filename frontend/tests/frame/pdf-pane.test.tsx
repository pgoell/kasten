/**
 * The reader over a real pdf, in real Chromium, with the real foliate and pdf.js.
 *
 * Every claim here is one jsdom cannot make and one the epub file next door
 * does not cover. foliate renders a pdf through `fixed-layout.js`, which hands
 * out no overlay, no section index and no way to build a page's document, so
 * three of the reader's four features are the pane's own work over a page
 * pdf.js drew. Nothing short of a browser draws that page.
 *
 * It also pins the build. `vite.config.ts` rewrites the one line of foliate's
 * `pdf.js` that names its own vendored worker and stylesheets, and without that
 * rewrite the dev server refuses the module outright while the build resolves
 * every one of those URLs to the string `undefined`. A pdf that opens at all is
 * that plumbing working.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { BookPane } from "@/components/book-pane";
// Three pages of selectable text and an outline of three entries, the third
// nested under the second, so the contents have a shape to draw.
import contentsUrl from "../fixtures/contents.pdf?url";
import { stubCommands } from "../stub-commands";
import "@/styles/app.css";

const NOTE = "00 Inbox/02 Documents/Fixture.md";
const BOOK = "00 Inbox/02 Documents/Fixture.pdf";

/** The words the fixture puts on its second page, which several cases seek. */
const ON_PAGE_TWO = "A passage worth taking out of the book.";

/** The words on the first page, which is where the reader opens. */
const ON_PAGE_ONE = "The first page of the fixture.";

const { fetchBook, fetchNote } = vi.hoisted(() => ({ fetchBook: vi.fn(), fetchNote: vi.fn() }));
// The reason `tests/frame/book-pane.test.tsx` mocks rather than seeds: the Perf
// job runs no backend and vite proxies `/api` to a dead port, and seeded query
// data is stale at once, so mounting would refetch against that dead port and
// swap the failure panel in over a page that had already drawn.
vi.mock("@/lib/api", () => ({
  fetchBook,
  fetchNote,
  fetchImages: () => Promise.resolve([]),
  uploadAsset: () => Promise.resolve(),
}));

/** Every page document foliate reported, which is the only way inside. */
const pages: Document[] = [];
document.addEventListener(
  "load",
  (event) => {
    const { doc } = (event as CustomEvent<{ doc?: Document }>).detail ?? {};
    if (doc) pages.push(doc);
  },
  true,
);

/**
 * Wait until pdf.js has drawn a page holding `words`.
 *
 * The words and not `getContents()[0]`. A fixed-layout renderer answers with the
 * whole spread, up to two frames, and the blank half of one comes first as often
 * as not; and a frame's `load` fires when its shell document loads, a good while
 * before `render` has put a canvas and a text layer in it.
 */
function pageShowing(words: string): Promise<Document> {
  return vi.waitFor(
    () => {
      const doc = pages.find((page) => (page.body.textContent ?? "").includes(words));
      expect(doc).toBeDefined();
      return doc as Document;
    },
    { timeout: 20_000 },
  );
}

/** Select the whole of one element's text, the way the epub file next door does. */
function selectWhole(doc: Document, element: Element): void {
  const node = element.firstChild as Node;
  const selection = doc.defaultView?.getSelection() as Selection;
  selection.removeAllRanges();
  selection.setBaseAndExtent(node, 0, node, node.textContent?.length ?? 0);
}

let mounted: { root: Root; container: Element } | null = null;

/**
 * Mount the reader over the pdf fixture, beside a note the caller writes.
 *
 * `seek` is the passage `gf` asked for, which the route hands down as a prop.
 */
async function drawPdf(note = "", seek?: { quote: string[] }) {
  fetchBook.mockResolvedValue({ path: BOOK, blob: await (await fetch(contentsUrl)).blob() });
  fetchNote.mockResolvedValue(note);
  const commands = stubCommands();
  const onTake = vi.fn();
  const onNotice = vi.fn();
  const container = document.createElement("div");
  // A real box, because a fixed-layout renderer scales its page to the element
  // it is in and a pane of no size draws nothing at all. Taller than it is
  // wide, so the spread is one page rather than two and the case is the one a
  // reader in a split pane sees.
  container.style.cssText = "width: 460px; height: 620px;";
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
        commands={commands}
        focusSignal={0}
        onFocus={() => {}}
        onMoved={() => {}}
        onLeaving={() => {}}
        onTake={onTake}
        onNotice={onNotice}
        seek={seek}
      />
    </QueryClientProvider>,
  );

  return { commands, onTake, onNotice, container };
}

/** The note as the vault holds it, with one highlight in it. */
function noteQuoting(quote: string): string {
  return `---\nid: one\ntype: Source\n---\n# Fixture\n\n## Highlights\n\n> ${quote}\n\nPage 2 ^hl-abc123\n`;
}

describe("the reader over a real pdf", () => {
  beforeEach(() => {
    pages.length = 0;
  });

  afterEach(async () => {
    // foliate reads its renderer inside a `requestAnimationFrame` it schedules
    // on load, so tearing down inside that same frame throws out of the library
    // and vitest counts an unhandled error.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
  });

  it("draws the first page, text layer and all", async () => {
    // The one that pins the whole build. A pdf that draws proves the worker
    // loaded from `/pdfjs/`, which the stock vite pipeline resolves to
    // `undefined`, and that the two stylesheets arrived as css rather than as
    // the javascript modules vite turns a fetched `.css` into: an unstyled text
    // layer lays every span out at the left edge in normal flow, so the
    // position is the assertion and not decoration.
    const { container } = await drawPdf();

    const doc = await pageShowing(ON_PAGE_ONE);
    expect(doc.querySelectorAll("canvas").length).toBe(1);
    const layer = doc.querySelector(".textLayer") as HTMLElement;
    expect(doc.defaultView?.getComputedStyle(layer).position).toBe("absolute");
    expect(container.querySelector("[role='alert']")).toBeNull();
  }, 40_000);

  it("turns the page on `l` and says how far through it is", async () => {
    const { container } = await drawPdf();
    await pageShowing(ON_PAGE_ONE);

    const pane = container.querySelector("[data-book-pane]") as HTMLElement;
    pane.focus();
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));

    await pageShowing(ON_PAGE_TWO);
    // Three pages, so the second is two thirds of the way through. The footer
    // is the only place the reader is told, and a fixed-layout renderer reports
    // `fraction: 0` on its own event, the whole-book number being worked out a
    // layer up.
    await vi.waitFor(() => expect(container.querySelector("footer")?.textContent).toBe("67%"), {
      timeout: 20_000,
    });
  }, 40_000);

  it("offers the take button over a selection, which a fixed-layout book refuses", async () => {
    // The refusal in `onSelectionChange` was written for a pre-paginated epub,
    // whose frames foliate scales with a css transform. A pdf goes through the
    // same renderer and is scaled inside its document instead, so the rects
    // survive and the passage is takeable. This is that difference.
    const { onTake, container } = await drawPdf();
    const doc = await pageShowing(ON_PAGE_ONE);

    const span = [...doc.querySelectorAll(".textLayer span")].find((one) =>
      (one.textContent ?? "").includes("first page"),
    ) as Element;
    selectWhole(doc, span);

    const button = await vi.waitFor(
      () => {
        const found = container.querySelector("[data-take]");
        expect(found).not.toBeNull();
        return found as HTMLElement;
      },
      { timeout: 20_000 },
    );

    // Inside the pane, which is the promise the placement makes: a rectangle
    // out of a frame foliate had scaled would land somewhere else entirely.
    const box = button.getBoundingClientRect();
    const pane = (container.querySelector("[data-book-pane]") as Element).getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(pane.left);
    expect(box.right).toBeLessThanOrEqual(pane.right);

    button.click();
    await vi.waitFor(() => expect(onTake).toHaveBeenCalled(), { timeout: 10_000 });
    const passage = onTake.mock.calls[0]?.[0] as { text: string; chapter: string };
    expect(passage.text).toContain("first page");
    // The outline entry the page is under, which a pdf has where a book has a
    // chapter. The `Page N` fallback is for a pdf whose author wrote no
    // outline, and this fixture has one.
    expect(passage.chapter).toBe("Front");
  }, 40_000);

  it("draws the note's highlights on the page", async () => {
    // foliate builds no overlay for a fixed-layout page and emits no
    // `create-overlay` (`fixed-layout.js:308-313`), so every part of this is
    // the pane's: it hangs foliate's own Overlayer inside the text layer and
    // waits on the layer filling rather than on an event nobody sends.
    await drawPdf(noteQuoting(ON_PAGE_ONE));
    const doc = await pageShowing(ON_PAGE_ONE);

    const painted = await vi.waitFor(
      () => {
        const rects = doc.querySelectorAll(".textLayer svg rect");
        expect(rects.length).toBeGreaterThan(0);
        return rects;
      },
      { timeout: 20_000 },
    );

    // Over the words and not at the origin, which is what an overlay hung
    // outside the page's own coordinate space would give.
    const drawnBox = (painted[0] as SVGElement).getBoundingClientRect();
    const words = (
      [...doc.querySelectorAll(".textLayer span")].find((one) =>
        (one.textContent ?? "").includes("first page"),
      ) as Element
    ).getBoundingClientRect();
    expect(Math.abs(drawnBox.left - words.left)).toBeLessThan(4);
    expect(Math.abs(drawnBox.top - words.top)).toBeLessThan(6);
  }, 40_000);

  it("draws the highlight over the words when the page is scaled", async () => {
    // The case a headless browser will not produce on its own. pdf.js lays a
    // page out at `zoom * devicePixelRatio` and scales the document back down
    // by `1 / dpr`, so on a retina screen the rectangles a range answers with
    // are half the coordinates the overlay draws in. Chromium here runs at a
    // ratio of 1, which makes the scaling a no-op and the case untested: the
    // overlay lines up whether or not the pane undoes anything.
    //
    // So the transform is set by hand rather than the ratio. It is the same
    // question, `pageScale` reading whatever pdf.js left on the root, and this
    // is the general form of it. Removing the counter-scale fails this and
    // nothing else in the file.
    await drawPdf(noteQuoting(ON_PAGE_ONE));
    const doc = await pageShowing(ON_PAGE_ONE);
    await vi.waitFor(
      () => expect(doc.querySelectorAll(".textLayer svg rect").length).toBeGreaterThan(0),
      {
        timeout: 20_000,
      },
    );

    doc.documentElement.style.transform = "scale(0.5)";
    doc.documentElement.style.transformOrigin = "top left";
    // The overlay is rebuilt when it has left the tree, which is what the draw
    // pass tests, and taking it out is also the childList change the watcher
    // draws on. One gesture asks for both.
    (doc.querySelector(".textLayer svg") as SVGElement).remove();

    const rect = await vi.waitFor(
      () => {
        const found = doc.querySelector(".textLayer svg rect");
        expect(found).not.toBeNull();
        return found as SVGElement;
      },
      { timeout: 20_000 },
    );

    const words = (
      [...doc.querySelectorAll(".textLayer span")].find((one) =>
        (one.textContent ?? "").includes("first page"),
      ) as Element
    ).getBoundingClientRect();
    const painted = rect.getBoundingClientRect();
    expect(Math.abs(painted.left - words.left)).toBeLessThan(4);
    expect(Math.abs(painted.top - words.top)).toBeLessThan(6);
  }, 40_000);

  it("keeps one text layer when the pane is resized", async () => {
    // foliate re-renders through its own ResizeObserver and pdf.js's TextLayer
    // appends rather than replaces, so the page's words read twice and every
    // highlight would anchor to the stale copy, `indexOf` taking the first of
    // the two. The pane watches the text layer's own children and throws away
    // every generation but the newest, foliate's `endOfContent` marking one.
    const { container } = await drawPdf();
    const doc = await pageShowing(ON_PAGE_ONE);
    const before = doc.querySelectorAll(".textLayer span").length;
    const canvas = doc.querySelector("canvas");
    expect(before).toBeGreaterThan(0);

    (container as HTMLElement).style.width = "560px";

    // That the re-render happened at all, asserted before the count is. Without
    // it a resize the observer never saw would leave the count trivially equal
    // and green the case with the prune never having run. `render` replaces the
    // canvas at the top of the same function that appends the text layer
    // (`pdf.js:38`), so a new canvas element is that function having run.
    await vi.waitFor(() => expect(doc.querySelector("canvas")).not.toBe(canvas), {
      timeout: 20_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(doc.querySelectorAll(".textLayer span").length).toBe(before);
    expect((doc.body.textContent ?? "").indexOf("first page")).toBe(
      (doc.body.textContent ?? "").lastIndexOf("first page"),
    );
  }, 40_000);

  it("takes `gf` to the page holding the quote", async () => {
    // A pdf's sections carry no `createDocument`, so the walk that serves an
    // epub finds nothing and would answer that a passage plainly in the file is
    // not there. This is the other arm: pdf.js parses each page's text without
    // drawing it.
    const { onNotice } = await drawPdf("", { quote: [ON_PAGE_TWO] });

    await pageShowing(ON_PAGE_TWO);
    expect(onNotice).not.toHaveBeenCalled();
  }, 40_000);

  it("says so when the passage is in no page", async () => {
    const { onNotice } = await drawPdf("", { quote: ["words this fixture has never held"] });

    await vi.waitFor(
      () => expect(onNotice).toHaveBeenCalledWith("That passage is not in the book"),
      { timeout: 30_000 },
    );
  }, 40_000);

  it("opens the page the note's own bookmark names", async () => {
    // A pdf has no cfi of its own, so foliate builds a fake one out of the page
    // index (`epubcfi.js:333-336`) and resolves it back the same way. `/6/6` is
    // the third page.
    await drawPdf("---\nid: one\nreading: epubcfi(/6/6)\n---\n# Fixture\n");

    const doc = await pageShowing("The last page of the fixture.");
    expect(doc.body.textContent).not.toContain("first page");
  }, 40_000);

  it("shows the contents the pdf's own outline gives", async () => {
    const { container } = await drawPdf();
    await pageShowing(ON_PAGE_ONE);

    const pane = container.querySelector("[data-book-pane]") as HTMLElement;
    pane.focus();
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));

    await vi.waitFor(
      () => {
        const rows = container.querySelectorAll("[role='option'], li, button");
        expect([...rows].map((row) => row.textContent).join(" ")).toContain("Middle");
      },
      { timeout: 20_000 },
    );
  }, 40_000);

  it("says nothing is beside the note when the vault has no file", async () => {
    fetchBook.mockRejectedValue(new Error("GET /api/books/... failed with 404"));
    fetchNote.mockResolvedValue("");
    const container = document.createElement("div");
    container.style.cssText = "width: 460px; height: 620px;";
    document.body.append(container);
    const root = createRoot(container);
    mounted = { root, container };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

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

    const panel = await vi.waitFor(
      () => {
        const found = container.querySelector("[role='alert']");
        expect(found).not.toBeNull();
        return found as HTMLElement;
      },
      { timeout: 10_000 },
    );
    // The note and both suffixes, because the pair is a convention and the
    // reader cannot know which of the two you meant to put there.
    expect(panel.textContent).toContain(NOTE);
    expect(panel.textContent).toContain(".epub");
    expect(panel.textContent).toContain(".pdf");
  }, 20_000);
});
