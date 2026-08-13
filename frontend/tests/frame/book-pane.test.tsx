/**
 * The reader over a real epub, in real Chromium, with the real foliate.
 *
 * jsdom lays nothing out, so a real paginator columnises to a box of zero and
 * never draws a page. The two claims this pull request rests on are exactly the
 * two a jsdom test cannot make: that a page draws at all, and that a key
 * pressed inside foliate's iframe reaches kasten.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "vitest/browser";
import { BookPane } from "@/components/book-pane";
// Three chapters and a nav holding three entries, the third nested under the
// second, for the cases that walk a real list of chapters.
import contentsUrl from "../fixtures/contents.epub?url";
// Two chapters, no nav document and no ncx, so `book.toc` is undefined: this is
// the fixture for a book whose publisher wrote no contents. Nothing else records
// that, an epub being a binary nobody unzips twice.
import plainUrl from "../fixtures/plain.epub?url";
import { stubCommands } from "../stub-commands";
// The app's own stylesheet, because the pane is sized by Tailwind's `h-full`
// and a wrapper of no height is a pane Playwright refuses to click and a
// paginator with nothing to columnise into.
import "@/styles/app.css";

const NOTE = "20 Literature/Plain.md";

/**
 * The top of the fixture's second chapter, spelled against its own spine.
 *
 * `/6/4` is the second `itemref` in the package, which is what `resolveCFI`
 * turns into a spine index, and `/4/4/1:0` is the start of the one paragraph in
 * that chapter's body.
 */
const CHAPTER_TWO = "epubcfi(/6/4!/4/4/1:0)";

/**
 * A bookmark from another edition, in the two shapes it fails in.
 *
 * `MISSING_SPINE` names an `itemref` this package has not got, so `resolveCFI`
 * answers `{ index: -1 }`, the renderer refuses it and nothing loads.
 * `MISSING_NODE` names one it has and a child of the body that chapter has not,
 * so the section loads and then `range.setStart` throws on a null node.
 */
const MISSING_SPINE = "epubcfi(/6/99!/4/4/1:0)";
const MISSING_NODE = "epubcfi(/6/4!/4/22/1:0)";

/** The literature note as the vault holds it, with a place in it. */
function noteAt(cfi: string): string {
  return `---\nid: one\nreading: ${cfi}\n---\n# Plain\n`;
}

const { fetchBook, fetchNote } = vi.hoisted(() => ({ fetchBook: vi.fn(), fetchNote: vi.fn() }));
// The Perf job runs no backend and vite proxies `/api` to a dead port, so the
// pane must not fetch here. Seeding the query instead is a trap: seeded data is
// stale at once under the default staleTime, so mounting refetches against the
// dead proxy anyway and the rejection swaps the error panel in over a book that
// already drew.
// `fetchImages` and `uploadAsset` are here because the module is replaced whole:
// the route and the editor import them, and a factory short of a name breaks the
// import rather than the call.
vi.mock("@/lib/api", () => ({
  fetchBook,
  fetchNote,
  fetchImages: () => Promise.resolve([]),
  uploadAsset: () => Promise.resolve(),
}));

/** Every `relocate` foliate emitted, recorded from before the first navigation. */
const located: { cfi?: string }[] = [];

/** Every section document foliate reported, which is the only way inside. */
const sections: Document[] = [];

/**
 * Listen on the document in the capture phase, before anything mounts.
 *
 * `view.init()` navigates during mount, so a listener added after awaiting the
 * render has already missed the first `relocate`. Recording into a list rather
 * than awaiting a promise made after the fact is what keeps this from flaking
 * on a fast machine and passing on a slow one.
 */
document.addEventListener(
  "relocate",
  (event) => located.push((event as CustomEvent<{ cfi?: string }>).detail),
  true,
);
document.addEventListener(
  "load",
  (event) => {
    const { doc } = (event as CustomEvent<{ doc?: Document }>).detail ?? {};
    if (doc) sections.push(doc);
  },
  true,
);

/**
 * Click at a point inside the section document, the way a reader does.
 *
 * Both of foliate's shadow roots are closed, so no locator reaches inside. The
 * document comes from foliate's own `load` event, and its iframe is reachable
 * as `defaultView.frameElement`, which works through a closed root because the
 * document is same origin. A bare `element.click()` proves neither focus nor
 * key delivery, which is most of what this file is for.
 */
async function clickInside(pane: Element, doc: Document, selector: string) {
  const target = doc.querySelector(selector);
  const frame = doc.defaultView?.frameElement;
  if (!target || !frame) throw new Error(`nothing at ${selector} inside the book`);

  // The pane rather than the paragraph, at the paragraph's place. Handing the
  // paragraph itself to `userEvent.click` resolves no locator, and the provider
  // falls back to `element.click()`, which fires a lone synthetic `click`: no
  // `pointerdown`, no focus, nothing this test is here to prove. Playwright
  // positions a click relative to the element it is given, so the sum of the
  // three rectangles puts a real pointer on the words.
  const outer = frame.getBoundingClientRect();
  const inner = target.getBoundingClientRect();
  const box = pane.getBoundingClientRect();
  await userEvent.click(pane, {
    position: {
      x: outer.left + inner.left + inner.width / 2 - box.left,
      y: outer.top + inner.top + inner.height / 2 - box.top,
    },
  });
}

/**
 * Wait for the rest of `draw` to run, which the `load` event is in the middle of.
 *
 * The anchor is resolved after the section has loaded, so a case asserting that
 * no error panel was drawn has to let the failure arrive before it says so.
 */
function drawn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

/**
 * Select from the top of `#para` twenty characters into the paragraph below.
 *
 * The range API and not a drag: a real drag over columnised text is the
 * flakiest thing this suite could hold, and the browser makes the same
 * selection either way. `backward` puts the focus at the start, which is what
 * dragging up the page does and what decides which end the button is drawn at.
 */
function selectTwoParagraphs(doc: Document, backward = false): void {
  const first = doc.querySelector("#para") as HTMLElement;
  const second = first.nextElementSibling as HTMLElement;
  const selection = doc.defaultView?.getSelection() as Selection;
  selection.removeAllRanges();
  if (backward) {
    selection.setBaseAndExtent(second.firstChild as Node, 20, first.firstChild as Node, 0);
    return;
  }
  selection.setBaseAndExtent(first.firstChild as Node, 0, second.firstChild as Node, 20);
}

/** Select the whole of one element's text, wherever it sits on the page. */
function selectWhole(doc: Document, element: Element): void {
  const node = element.firstChild as Node;
  const selection = doc.defaultView?.getSelection() as Selection;
  selection.removeAllRanges();
  selection.setBaseAndExtent(node, 0, node, node.textContent?.length ?? 0);
}

/** Whether the button's whole box lies inside the pane's, which is the promise. */
function inside(button: HTMLElement, container: HTMLElement): boolean {
  const pane = (container.querySelector("[data-book-pane]") as Element).getBoundingClientRect();
  const box = button.getBoundingClientRect();
  return (
    box.left >= pane.left &&
    box.right <= pane.right &&
    box.top >= pane.top &&
    box.bottom <= pane.bottom
  );
}

/** The take button, once the pane has drawn one over the selection. */
function takeButton(container: HTMLElement): Promise<HTMLElement> {
  return vi.waitFor(
    () => {
      const found = container.querySelector("[data-take]");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    },
    { timeout: 10_000 },
  );
}

let mounted: { root: Root; container: HTMLElement } | null = null;

/**
 * Mount the reader over the fixture, beside a note the caller writes.
 *
 * `note` is the literature note's whole text, which is where `reading:` lives
 * and so where the restore cases put the cfi they are about. `book` is the
 * fixture to read, which is `plain.epub` for every case that wants no contents.
 */
async function drawBook(note = "", book = plainUrl) {
  fetchBook.mockResolvedValue(await (await fetch(book)).blob());
  fetchNote.mockResolvedValue(note);
  const commands = stubCommands();
  const onFocus = vi.fn();
  const onTake = vi.fn();
  const container = document.createElement("div");
  // A real box, because the paginator columnises to the element it is in and a
  // pane of no size draws no page.
  container.style.cssText = "width: 600px; height: 400px;";
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
        onFocus={onFocus}
        onMoved={() => {}}
        onLeaving={() => {}}
        onTake={onTake}
        onNotice={() => {}}
      />
    </QueryClientProvider>,
  );

  return { commands, onFocus, onTake, container };
}

describe("the reader over a real book", () => {
  beforeEach(() => {
    located.length = 0;
    sections.length = 0;
  });

  afterEach(async () => {
    // foliate schedules a `requestAnimationFrame` on every section load and
    // reads its renderer inside it (`paginator.js:1113`), so tearing down
    // within that same frame throws out of the library and vitest counts an
    // unhandled error. Let the frame run first. The teardown itself is pinned
    // in `tests/book-pane.test.tsx`, which is not racing a real renderer.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
  });

  it("draws the first page", async () => {
    // What catches a missing `view.init()`: `View.open` builds the renderer and
    // navigates nowhere, so the pane draws a blank page and every key looks
    // broken. A `relocate` arriving at all means something navigated.
    await drawBook();

    await vi.waitFor(() => expect(located.length).toBeGreaterThan(0), { timeout: 10_000 });
  }, 20_000);

  it("opens the chapter the note's own cfi names", async () => {
    // The claim jsdom cannot make: the fake resolves whatever the test says,
    // and what is in question is what foliate does with a real spine.
    await drawBook(noteAt(CHAPTER_TWO));

    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(sections[0]?.title).toBe("Two");
  }, 30_000);

  it("draws a chapter when the saved place names a spine item this book has not", async () => {
    const { container } = await drawBook(noteAt(MISSING_SPINE));

    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await drawn();
    expect(container.querySelector("[role='alert']")).toBeNull();
  }, 30_000);

  it("draws a chapter when the saved place names a node this chapter has not", async () => {
    const { container } = await drawBook(noteAt(MISSING_NODE));

    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await drawn();
    // The chapter the stale cfi named, which is a better landing than the front
    // of the book and is what the catch leaves behind.
    expect(sections[0]?.title).toBe("Two");
    expect(container.querySelector("[role='alert']")).toBeNull();
  }, 30_000);

  it("answers a click and the keys that follow it, from inside the iframe", async () => {
    // The case the whole design is arranged around. An event does not cross a
    // document boundary, so a handler on the pane's wrapper alone works right
    // up until somebody clicks a paragraph, which is what a reader does first.
    const { commands, onFocus, container } = await drawBook();
    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(located.length).toBeGreaterThan(0), { timeout: 10_000 });
    const doc = sections[0] as Document;

    const seen: string[] = [];
    for (const kind of ["pointerdown", "mousedown", "click", "focusin"])
      doc.addEventListener(kind, () => seen.push(kind));
    await clickInside(container.querySelector("[data-book-pane]") as Element, doc, "p");

    // Asserted before a single key is pressed, which is what proves the
    // pointer path reaches out of the iframe at all.
    expect(seen).toContain("pointerdown");
    expect(onFocus).toHaveBeenCalled();

    const before = located.length;
    await userEvent.keyboard("l");
    await vi.waitFor(() => expect(located.length).toBeGreaterThan(before), { timeout: 10_000 });

    await userEvent.keyboard("{Control>}{Shift>}L{/Shift}{/Control}");
    await vi.waitFor(() => expect(commands.paneRight).toHaveBeenCalled(), { timeout: 10_000 });
  }, 30_000);

  it("takes what a selection over two paragraphs says, on a click of its button", async () => {
    // The case that fails when somebody reads `range.toString()`, which runs
    // the paragraphs together and reads almost right. The text is asserted
    // exactly for that reason.
    const { container, onTake } = await drawBook();
    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(located.length).toBeGreaterThan(0), { timeout: 10_000 });

    selectTwoParagraphs(sections[0] as Document);
    await userEvent.click(await takeButton(container));

    // `plain.epub` carries no nav and no ncx, so the chapter falls back to the
    // section it was selected in.
    expect(onTake).toHaveBeenCalledWith({
      text: "First paragraph.\n\nParagraph 1 of the c",
      chapter: "Section 1",
    });
  }, 30_000);

  it("takes the passage on y pressed after a real click into a paragraph", async () => {
    // The claim PR 1 makes for `h` and `l` and this makes for the take: a
    // handler on the pane's wrapper alone stops answering the moment somebody
    // clicks the text, which is what a reader does first.
    const { container, onTake } = await drawBook();
    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(located.length).toBeGreaterThan(0), { timeout: 10_000 });
    const doc = sections[0] as Document;

    await clickInside(container.querySelector("[data-book-pane]") as Element, doc, "#para");
    // foliate's own selection debounce turns a page 700ms after a selection
    // has run past the visible range, and a turn locks the paginator for the
    // 100ms after it.
    await new Promise((settle) => setTimeout(settle, 900));
    selectTwoParagraphs(doc);
    await takeButton(container);
    await userEvent.keyboard("y");

    await vi.waitFor(() => expect(onTake).toHaveBeenCalled(), { timeout: 10_000 });
    expect(onTake).toHaveBeenCalledWith({
      text: "First paragraph.\n\nParagraph 1 of the c",
      chapter: "Section 1",
    });
  }, 30_000);

  it("draws the button at the end a backward drag finished at", async () => {
    // `getClientRects` answers in document order, so the last rectangle is the
    // far end of a selection made upward, which is the end the hand is not at.
    const { container } = await drawBook();
    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(located.length).toBeGreaterThan(0), { timeout: 10_000 });
    const doc = sections[0] as Document;

    selectTwoParagraphs(doc);
    const forward = (await takeButton(container)).getBoundingClientRect();
    selectTwoParagraphs(doc, true);
    const backward = await vi.waitFor(
      () => {
        const box = (container.querySelector("[data-take]") as HTMLElement).getBoundingClientRect();
        expect(box.top).not.toBe(forward.top);
        return box;
      },
      { timeout: 10_000 },
    );

    // The first rectangle is the one the paragraph above starts on, so the
    // button sits higher up the page than the forward drag left it.
    expect(backward.top).toBeLessThan(forward.top);
  }, 30_000);

  it("keeps the button inside the pane for a selection off the drawn page", async () => {
    // The paginator expands the iframe to the whole columnised chapter and
    // scrolls the box around it, so a selection eight paragraphs down maps to
    // something like 913 in a 600 wide pane. The assertion is on the drawn box
    // and not on the number, because the clamp is on a point and the promise is
    // about a box.
    const { container } = await drawBook();
    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(located.length).toBeGreaterThan(0), { timeout: 10_000 });
    const doc = sections[0] as Document;

    selectWhole(doc, doc.querySelectorAll("p")[8] as Element);

    expect(inside(await takeButton(container), container)).toBe(true);
  }, 30_000);

  it("keeps it inside for a selection on the first line of the page", async () => {
    // The other axis. The transform lifts the button a whole height above the
    // words, so an inset covering half its width and not its height clears the
    // sides and pokes out of the top.
    const { container } = await drawBook();
    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(located.length).toBeGreaterThan(0), { timeout: 10_000 });
    const doc = sections[0] as Document;

    selectWhole(doc, doc.querySelector("h1") as Element);

    expect(inside(await takeButton(container), container)).toBe(true);
  }, 30_000);

  it("opens the contents on t, from inside the iframe", async () => {
    // The only case that makes the claim the contents rest on. The jsdom cases
    // dispatch a key on a detached document, which shows the handler landed on
    // whatever document the `load` event carried and nothing about focus, an
    // iframe or where a real key press goes.
    const { container } = await drawBook("", contentsUrl);
    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(located.length).toBeGreaterThan(0), { timeout: 10_000 });
    const pane = container.querySelector("[data-book-pane]") as Element;

    await clickInside(pane, sections[0] as Document, "p");
    // Let the click settle before pressing anything. foliate watches the book's
    // own `selectionchange` on a 700ms debounce and turns a page when a
    // selection has run past the visible range (`paginator.js:585-595`), and a
    // page turn locks the paginator for the 100ms after it
    // (`paginator.js:1060-1070`). `goTo` is silently dropped while that lock
    // holds (`paginator.js:1022-1023`), which is a jump lost with nothing
    // logged anywhere.
    await new Promise((settle) => setTimeout(settle, 900));
    await userEvent.keyboard("t");

    const dialog = await vi.waitFor(
      () => {
        const found = container.querySelector("[role='dialog']");
        expect(found).not.toBeNull();
        return found as Element;
      },
      { timeout: 10_000 },
    );
    // The dialog takes the focus in a mount effect, and that is what pulls the
    // cursor out of the book's iframe. A `j` pressed before it has landed goes
    // back into the chapter and the highlight never moves.
    await vi.waitFor(() => expect(document.activeElement).toBe(dialog), { timeout: 10_000 });

    await userEvent.keyboard("j");
    await vi.waitFor(
      () => expect(dialog.querySelector("[aria-selected='true']")?.textContent).toBe("Two"),
      { timeout: 10_000 },
    );
    await userEvent.keyboard("{Enter}");

    // The chapter and not a second `load`, which any reload satisfies. The wait
    // is not optional either: `onGo` does not await `goTo`, and foliate's own
    // `goTo` awaits the renderer, so an assertion in the same tick still sees
    // chapter one.
    await vi.waitFor(() => expect(sections.at(-1)?.title).toBe("Two"), { timeout: 10_000 });
    expect(container.querySelector("[role='dialog']")).toBeNull();
  }, 30_000);
});
