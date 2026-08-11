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
import plainUrl from "../fixtures/plain.epub?url";
import { stubCommands } from "../stub-commands";
// The app's own stylesheet, because the pane is sized by Tailwind's `h-full`
// and a wrapper of no height is a pane Playwright refuses to click and a
// paginator with nothing to columnise into.
import "@/styles/app.css";

const NOTE = "20 Literature/Plain.md";

const { fetchBook } = vi.hoisted(() => ({ fetchBook: vi.fn() }));
// The Perf job runs no backend and vite proxies `/api` to a dead port, so the
// pane must not fetch here. Seeding the query instead is a trap: seeded data is
// stale at once under the default staleTime, so mounting refetches against the
// dead proxy anyway and the rejection swaps the error panel in over a book that
// already drew.
vi.mock("@/lib/api", () => ({ fetchBook }));

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

let mounted: { root: Root; container: HTMLElement } | null = null;

async function drawBook() {
  fetchBook.mockResolvedValue(await (await fetch(plainUrl)).blob());
  const commands = stubCommands();
  const onFocus = vi.fn();
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
      <BookPane note={NOTE} paths={[NOTE]} commands={commands} focusSignal={0} onFocus={onFocus} />
    </QueryClientProvider>,
  );

  return { commands, onFocus, container };
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
});
