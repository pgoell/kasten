import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "vitest/browser";
import { BookPane } from "@/components/book-pane";
import { fetchBook, fetchNote } from "@/lib/api";
// A book written for a white page (#467). Two chapters, `One` and `Two`, with
// the same markup and one stylesheet: `body { color: #000; background: #fff }`,
// `p { color: #000 }`, `h1 { color: #c00 }`, `.box { color: #222; background:
// #fafafa }`, `.ink { color: #333 }`, `.item` and `.deep` at `#222`, `.cell`
// at `#222` on `#eee`, `.strong { color: #111 !important }` and
// `a.link { color: #00c }` and `figure { background: #fff }`. The markup puts
// `.box` on a div around a paragraph, `.ink` on a span, `.item` on a list
// item, `.cell` on a table cell, `.strong` on a paragraph, `.link` on a link
// holding a `.deep` span, and adds an `img` of a 64 pixel svg square. After it
// come the shapes #469 to #471 are about: a figure holding `art.png`, black
// lines on a transparent background, over a caption; the same png inside a
// real link; an anchor with no `href` round an h2's text and a span; an inline
// svg holding a default-fill `<text>` and a `currentColor` rect; an `object`
// of the svg square; a `picture` holding the png; and an svg holding the png
// as an `<image>`, the shape of a calibre cover page. Chapter one also holds a
// `<mark>` the stylesheet says nothing about. Each element carries an id the
// stylesheet never names (`#heading`, `#box`, `#ink`, `#item`, `#cell`,
// `#strong`, `#link`, `#deep`, `#pic`, `#figure`, `#art`, `#caption`,
// `#realpic`, `#linkpic`, `#anchored`, `#chap1`, `#anchorspan`, `#svg`,
// `#svgtext`, `#svgrect`, `#obj`, `#picture`, `#cover`, `#mark`), there only
// for the tests to find it. Chapter one is short enough that a turn or two reaches
// chapter two.
import darkUrl from "../fixtures/dark-text.epub?url";
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

/** Every `relocate` foliate emitted, recorded from before the first navigation. */
export const located: { cfi?: string }[] = [];

/** Every section document foliate reported, which is the only way inside. */
export const sections: Document[] = [];

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
 * The mounted pane, kept by the test file that mounts it.
 *
 * Each test file unmounts its pane in `afterEach` and one case clears the
 * variable itself, so the variable belongs to the file and not to this module.
 * `trackMounted` hands each new root to the file's own binding.
 */
let onMounted: (mounted: { root: Root; container: HTMLElement }) => void = () => {};

/** Called once at the top of a test file, before its describe. */
export function trackMounted(track: typeof onMounted): void {
  onMounted = track;
}

/**
 * Click at a point inside the section document, the way a reader does.
 *
 * Both of foliate's shadow roots are closed, so no locator reaches inside. The
 * document comes from foliate's own `load` event, and its iframe is reachable
 * as `defaultView.frameElement`, which works through a closed root because the
 * document is same origin. A bare `element.click()` proves neither focus nor
 * key delivery, which is most of what this file is for.
 */
export async function clickInside(pane: Element, doc: Document, selector: string) {
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
export function drawn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

/** One property of one element of a chapter, as the chapter computes it. */
export function computed(
  doc: Document,
  selector: string,
  property: "color" | "backgroundColor" | "fill" | "filter",
): string {
  const element = doc.querySelector(selector);
  if (!element) throw new Error(`nothing at ${selector} inside the book`);
  return (doc.defaultView as Window).getComputedStyle(element)[property];
}

/** The dark-text fixture's first chapter, drawn. */
export async function drawDark(): Promise<{ doc: Document; container: HTMLElement }> {
  const { container } = await drawBook("", darkUrl);
  await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
  await drawn();
  return { doc: sections.at(-1) as Document, container };
}

/**
 * Mount the reader over the fixture, beside a note the caller writes.
 *
 * `note` is the literature note's whole text, which is where `reading:` lives
 * and so where the restore cases put the cfi they are about. `book` is the
 * fixture to read, which is `plain.epub` for every case that wants no contents.
 */
export async function drawBook(note = "", book = plainUrl) {
  // The Perf job runs no backend and vite proxies `/api` to a dead port, so the
  // pane must not fetch here. Seeding the query instead is a trap: seeded data is
  // stale at once under the default staleTime, so mounting refetches against the
  // dead proxy anyway and the rejection swaps the error panel in over a book that
  // already drew. The test files mock `@/lib/api` instead, and this module reaches
  // those fakes through the import above.
  // The pane asks the vault what is beside the note and is answered with the
  // file's own path, so a mock hands back both halves.
  vi.mocked(fetchBook).mockResolvedValue({
    path: NOTE.replace(/\.md$/, ".epub"),
    blob: await (await fetch(book)).blob(),
  });
  vi.mocked(fetchNote).mockResolvedValue(note);
  const commands = stubCommands();
  const onFocus = vi.fn();
  const onTake = vi.fn();
  const container = document.createElement("div");
  // A real box, because the paginator columnises to the element it is in and a
  // pane of no size draws no page.
  container.style.cssText = "width: 600px; height: 400px;";
  document.body.append(container);

  const root = createRoot(container);
  onMounted({ root, container });
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
