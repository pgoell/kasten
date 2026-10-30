/**
 * The reader over a real epub, in real Chromium, with the real foliate.
 *
 * jsdom lays nothing out, so a real paginator columnises to a box of zero and
 * never draws a page. The two claims this pull request rests on are exactly the
 * two a jsdom test cannot make: that a page draws at all, and that a key
 * pressed inside foliate's iframe reaches kasten.
 */

import type { Root } from "react-dom/client";
import { userEvent } from "vitest/browser";
import type { FoliateView } from "@/lib/book/foliate-view";
// Three chapters and a nav holding three entries, the third nested under the
// second, for the cases that walk a real list of chapters.
import contentsUrl from "../fixtures/contents.epub?url";
// Not a zip at all, handed over as the epub beside the note.
import notBookUrl from "../fixtures/daily-notes.json?url";
import { COARSE, stubMatchMedia } from "../match-media";
import { clickInside, drawBook, drawn, located, sections, trackMounted } from "./book-pane-fixture";

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

  it("closes in the frame a chapter landed in", async () => {
    // foliate's paginator queues a frame on every section load that reads its
    // view (`paginator.js:1113`), and closing nulls that view. A frame loop
    // started before the book queues its next callback ahead of that one, so
    // the close below always runs first in the frame the chapter landed in:
    // the order #213 only met by chance at the end of a test.
    const closed = new Promise<void>((resolve) => {
      const tick = () => {
        if (sections.length === 0) {
          requestAnimationFrame(tick);
          return;
        }
        mounted?.root.unmount();
        mounted?.container.remove();
        mounted = null;
        resolve();
      };
      requestAnimationFrame(tick);
    });
    await drawBook();
    await closed;
    // Two more frames, so a throw from the one queued behind the close lands
    // inside this test rather than after it.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }, 30_000);

  it("lays out nothing while a chapter's document has no root yet", async () => {
    // The paginator's resize observer renders whatever view it holds, and it
    // holds the next chapter's view before that document has parsed (#318).
    // Taking the root off a loaded section is the same state on demand, and
    // `render()` is what the observer calls.
    const { container } = await drawBook();
    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await drawn();
    const view = container.querySelector("foliate-view") as HTMLElement & {
      renderer: { render: () => void };
    };

    sections.at(-1)?.documentElement.remove();

    expect(() => view.renderer.render()).not.toThrow();
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

  it("turns the page on l pressed while the book is still opening", async () => {
    // `init` opens a book with no bookmark through the paginator's own `next()`,
    // which holds its turn lock for 100ms after the first page has already
    // reported (`paginator.js:1060-1071`). A key in that window was dropped
    // without a word (#370). Pressed inside that first `relocate` so the press
    // lands in the window on every run rather than on a slow one.
    // Measured by where the text is, not by the reason: a flowing book's turn is
    // a scroll step, which foliate reports with no reason at all, so no
    // `page` ever arrives. The renderer's `start` is the offset it scrolled to.
    const scrolled = { at: -1, renderer: undefined as { start: number } | undefined };
    const press = (event: Event) => {
      // The load-time expand reports before the section's `load` has gone out,
      // and so before the pane listens on its document.
      if (sections.length === 0) return;
      document.removeEventListener("relocate", press, true);
      const { renderer } = event.target as unknown as { renderer: { start: number } };
      scrolled.renderer = renderer;
      scrolled.at = renderer.start;
      sections[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    };
    document.addEventListener("relocate", press, true);
    await drawBook();

    await vi.waitFor(() => expect(scrolled.renderer?.start).toBeGreaterThan(scrolled.at), {
      timeout: 10_000,
    });
  }, 30_000);

  it("turns the page on a tap near the right edge while the book is still opening", async () => {
    // The same window as the case above, under a finger (#372). The pane only
    // listens for taps where the pointer is coarse.
    stubMatchMedia({ [COARSE]: true });
    // The text's place, not the reason: a flowing book's edge tap is a scroll
    // step, which foliate reports with no reason (see the case above).
    const scrolled = { at: -1, renderer: undefined as { start: number } | undefined };
    const tap = (event: Event) => {
      if (sections.length === 0) return;
      document.removeEventListener("relocate", tap, true);
      const { renderer } = event.target as unknown as { renderer: { start: number } };
      scrolled.renderer = renderer;
      scrolled.at = renderer.start;
      const doc = sections[0] as Document;
      const frame = doc.defaultView?.frameElement as HTMLElement;
      const pane = (document.querySelector("[data-book-pane]") as Element).getBoundingClientRect();
      const outer = frame.getBoundingClientRect();
      // A tenth of the pane in from its right edge, put back into the frame's
      // own coordinates the way the pane takes them out: the paginator widens
      // the frame to the whole chapter and scrolls it.
      const x = pane.left + pane.width * 0.9 - outer.left;
      const clientX = (x * frame.offsetWidth) / outer.width;
      doc.body.dispatchEvent(new MouseEvent("click", { clientX, bubbles: true, cancelable: true }));
    };
    document.addEventListener("relocate", tap, true);
    await drawBook();

    await vi.waitFor(() => expect(scrolled.renderer?.start).toBeGreaterThan(scrolled.at), {
      timeout: 10_000,
    });
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

/** The pane's host, which the view is appended to. */
function host(container: HTMLElement): HTMLElement {
  return (container.querySelector("foliate-view") as HTMLElement).parentElement as HTMLElement;
}

/** Where the view stood the moment the mark landed, read by an observer in that same task. */
function placeWhenMarked(container: HTMLElement): Promise<string | undefined> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const marked = container.querySelector("[data-ready]");
      if (marked === null) return;
      observer.disconnect();
      const view = marked.querySelector("foliate-view") as FoliateView | null;
      resolve(view?.lastLocation?.cfi);
    });
    observer.observe(container, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-ready"],
    });
  });
}

describe("the book view's ready mark", () => {
  beforeEach(() => {
    located.length = 0;
    sections.length = 0;
  });

  afterEach(() => {
    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
  });

  it("marks its host data-ready once the open ends, with the bookmark already landed", async () => {
    const { container } = await drawBook(`---\nreading: ${CHAPTER_TWO}\n---\n`);
    const cfi = await placeWhenMarked(container);

    expect(cfi).toMatch(/^epubcfi\(\/6\/4!/);
    expect(host(container).hasAttribute("data-ready")).toBe(true);
    expect(container.querySelectorAll("[data-ready]")).toHaveLength(1);
  }, 30_000);

  it("drops the mark when the pane closes, so the next open starts unmarked", async () => {
    const { container } = await drawBook();
    await vi.waitFor(() => expect(container.querySelector("[data-ready]")).not.toBeNull(), {
      timeout: 30_000,
    });
    const element = host(container);

    mounted?.root.unmount();

    expect(element.hasAttribute("data-ready")).toBe(false);
    const { container: next } = await drawBook();
    expect(next.querySelector("[data-ready]")).toBeNull();
    await vi.waitFor(() => expect(next.querySelector("[data-ready]")).not.toBeNull(), {
      timeout: 30_000,
    });
  }, 60_000);

  it("never marks a book that fails to open", async () => {
    const { container } = await drawBook("", notBookUrl);
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull(), {
      timeout: 30_000,
    });

    expect(container.querySelector("[data-ready]")).toBeNull();
  }, 30_000);

  it("changes nothing in how the book looks: no style reads the mark, and the host keeps its class", async () => {
    const { container } = await drawBook();
    await vi.waitFor(() => expect(container.querySelector("foliate-view")).not.toBeNull());
    const element = host(container);
    const before = element.className;
    await vi.waitFor(() => expect(element.hasAttribute("data-ready")).toBe(true), {
      timeout: 30_000,
    });

    expect(element.className).toBe(before);
    expect(element.getAttribute("style")).toBeNull();
    const selectors = [...document.styleSheets].flatMap((sheet) =>
      [...sheet.cssRules].map((rule) => (rule as CSSStyleRule).selectorText ?? ""),
    );
    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.filter((selector) => selector.includes("data-ready"))).toEqual([]);
  }, 30_000);
});
