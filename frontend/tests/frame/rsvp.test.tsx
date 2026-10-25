/**
 * The RSVP reader over the four panes that read, in real Chromium: a pdf drawn
 * by pdf.js, a page served with the backend's own script, an epub and a pdf
 * read as books by the real foliate.
 *
 * Each case asks the pane the way the route does, by raising the count it is
 * handed, and reads the words the reader puts on screen. The text is the
 * pane's own, so a case that shows the right word shows the source works end to
 * end: pdf.js's text items, the page script's `text` answer, foliate's section
 * documents and a cfi turned into a word and back.
 */

import "./pdf-take-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { commands as browser, userEvent } from "vitest/browser";
import { BookPane } from "@/components/book-pane";
import { HtmlPane } from "@/components/html-pane";
import { PdfPane } from "@/components/pdf-pane";
import type { FoliateView } from "@/lib/foliate-view";
import type { RsvpAsk } from "@/lib/use-rsvp";
import "@/styles/app.css";
import contentsUrl from "../fixtures/contents.pdf?url";
import plainUrl from "../fixtures/plain.epub?url";
import { stubCommands } from "../stub-commands";

const { fetchBook, fetchNote, fetchRsvp, saveRsvp } = vi.hoisted(() => ({
  fetchBook: vi.fn(),
  fetchNote: vi.fn(),
  fetchRsvp: vi.fn(),
  saveRsvp: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchBook,
  fetchNote,
}));
vi.mock("@/lib/rsvp-api", () => ({ fetchRsvp, saveRsvp }));

// pdf.js and foliate load on the first draw, which runs past vitest's 15 s.
vi.setConfig({ testTimeout: 40_000 });

let mounted: { root: Root; host: HTMLElement } | null = null;
/** One client per test, so a second draw is a new press and not a new book. */
let client: QueryClient;

beforeEach(() => {
  fetchRsvp.mockResolvedValue(null);
  saveRsvp.mockResolvedValue({});
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = "width: 700px; height: 600px; display: flex;";
  mounted = { root: createRoot(host), host };
});

afterEach(async () => {
  // foliate reads its renderer in a frame it schedules on load.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (mounted) flushSync(() => mounted?.root.unmount());
  mounted?.host.remove();
  mounted = null;
  await browser.unservePages();
});

/** Draw `pane` for an ask with `signal`, the same root each time, so a new count is a press. */
function draw(pane: (rsvp: RsvpAsk) => ReactNode, signal: number) {
  flushSync(() =>
    mounted?.root.render(
      <QueryClientProvider client={client}>
        <div className="flex h-full w-full flex-col">{pane({ here: false, signal })}</div>
      </QueryClientProvider>,
    ),
  );
}

/** The chunk on screen, once the reader has read its text. */
async function shown(): Promise<string> {
  return vi.waitFor(
    () => {
      const output = document.querySelector("[role='dialog'] output");
      expect(output?.children.length).toBe(3);
      return [...(output?.children ?? [])].map((span) => span.textContent).join("");
    },
    { timeout: 20_000 },
  );
}

/** The reader's top line: the word you are on, of how many. */
function counter(): string {
  return document.querySelector("[role='dialog'] .tabular-nums")?.textContent ?? "";
}

async function press(key: string) {
  await userEvent.keyboard(key === " " ? " " : key);
}

describe("RSVP over a pdf pane", () => {
  it("reads the pdf's pages and walks a paragraph, which is a page", async () => {
    const pane = (rsvp: RsvpAsk) => (
      <PdfPane
        path="rsvp/plan.pdf"
        opened={1}
        commands={stubCommands()}
        focusSignal={1}
        onNoteBeside={() => {}}
        rsvp={rsvp}
      />
    );
    draw(pane, 0);
    await vi.waitFor(
      () => expect(document.querySelector("[data-pdf-page='1'] .textLayer span")).not.toBeNull(),
      { timeout: 20_000 },
    );
    draw(pane, 1);

    expect(await shown()).toBe("A");
    await press("L");
    // Page one is "A passage worth taking" and "The first page of the fixture.".
    expect(await shown()).toBe("The");
    expect(counter()).toMatch(/^11 \//);
  });
});

describe("RSVP over a page", () => {
  it("reads the page's own text through its script", async () => {
    await browser.servePage(
      "rsvp/page.html",
      "<!doctype html><title>page</title><body><h1>A title</h1><p>First one. Second one.</p><p hidden>Hidden words.</p></body>",
    );
    const pane = (rsvp: RsvpAsk) => (
      <HtmlPane path="rsvp/page.html" commands={stubCommands()} onFocus={() => {}} rsvp={rsvp} />
    );
    draw(pane, 0);
    const frame = document.querySelector("iframe") as HTMLIFrameElement;
    await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    draw(pane, 1);

    expect(await shown()).toBe("A");
    await press("l");
    expect(await shown()).toBe("First");
    await press("l");
    expect(await shown()).toBe("Second");
    // Six words: the hidden paragraph is not read.
    expect(counter()).toMatch(/^5 \/ 6,/);
  });
});

/** The book pane over `url`, with the note it reads beside holding `note`. */
function bookPane(url: string, path: string, onMoved: (cfi: string) => void) {
  return async (note = "") => {
    fetchBook.mockResolvedValue({ path, blob: await (await fetch(url)).blob() });
    fetchNote.mockResolvedValue(note);
    return (rsvp: RsvpAsk) => (
      <BookPane
        note={path.replace(/\.\w+$/, ".md")}
        paths={[path.replace(/\.\w+$/, ".md")]}
        commands={stubCommands()}
        focusSignal={0}
        onFocus={() => {}}
        onMoved={onMoved}
        onLeaving={() => {}}
        onTake={async () => null}
        archive={false}
        onNoteBeside={() => {}}
        onNotice={() => {}}
        rsvp={rsvp}
      />
    );
  };
}

/**
 * Ask once the book has opened. foliate's element reports where it is once
 * `init` has navigated, and the pane counts the book ready right after, so the
 * wait is on that and then on the rest of the draw, as `drawn` in the book
 * fixture waits. Asking earlier would show "The book is still opening".
 */
async function askWhenOpen(pane: (rsvp: RsvpAsk) => ReactNode) {
  draw(pane, 0);
  await vi.waitFor(
    () => {
      const view = document.querySelector("foliate-view") as FoliateView | null;
      expect(view?.lastLocation).toBeTruthy();
    },
    { timeout: 30_000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  draw(pane, 1);
}

describe("RSVP over a book", () => {
  it("reads an epub, and moves between its place and reading:", async () => {
    const moved: string[] = [];
    const pane = await bookPane(plainUrl, "rsvp/Plain.epub", (cfi) => moved.push(cfi))();
    await askWhenOpen(pane);

    const first = await shown();
    expect(first).not.toBe("");
    await press("L");
    await press("L");
    const later = counter();
    expect(later).not.toMatch(/^1 \//);

    await press("r");
    await vi.waitFor(() => expect(moved.some((cfi) => cfi.startsWith("epubcfi("))).toBe(true));
    const written = moved.find((cfi) => cfi.startsWith("epubcfi(")) as string;

    // Back to the top, then `R` reads the cfi `r` wrote off the note.
    fetchNote.mockResolvedValue(`---\nreading: ${written}\n---\n`);
    await press("H");
    await press("H");
    await press("H");
    await press("R");
    await vi.waitFor(() => expect(counter().split(",")[0]).toBe(later.split(",")[0]));
  });

  it("reads a pdf opened as a book, page by page", async () => {
    const moved: string[] = [];
    const pane = await bookPane(contentsUrl, "rsvp/Contents.pdf", (cfi) => moved.push(cfi))();
    await askWhenOpen(pane);

    expect(await shown()).not.toBe("");
    const start = counter();
    await press("L");
    await vi.waitFor(() => expect(counter()).not.toBe(start));
    await press("r");
    await vi.waitFor(() => expect(moved.length).toBeGreaterThan(0));
  });
});
