import type { Root } from "react-dom/client";
import { userEvent } from "vitest/browser";
import { clickInside, drawBook, located, sections, trackMounted } from "./book-pane-fixture";

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
});
