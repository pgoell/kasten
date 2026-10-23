import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import { usePdfTake } from "@/components/pdf-take";
import { noteBase } from "@/lib/note-base";
import { reset } from "@/lib/outbox";
import { pdfQuote } from "@/lib/pdf-take";
import { periodicNote } from "@/lib/periodic";
import { stubMatchMedia } from "./match-media";

const { fetchNote, saveNote, updateNote, searchNotes } = vi.hoisted(() => ({
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
  updateNote: vi.fn(),
  searchNotes: vi.fn(),
}));
vi.mock("@/lib/api", () => {
  // A class of its own, as the real one is, so `instanceof` in the take answers the same.
  class ChangedOnDisk extends Error {}
  return { fetchNote, saveNote, updateNote, searchNotes, ChangedOnDisk };
});

/** Holds each take's keep until the test lets it go, so two takes can be in flight at once. */
const { gate } = vi.hoisted(() => ({ gate: { hold: null as Promise<void> | null } }));
vi.mock("@/lib/outbox", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/outbox")>();
  return {
    ...real,
    keep: async (text: string, date: string) => {
      if (gate.hold !== null) await gate.hold;
      return real.keep(text, date);
    },
  };
});

// The take goes through the real outbox, which keeps the dump in IndexedDB.

const PATH = "30 Research/report.pdf";
const WORDS = "Two words here.";
const QUOTE = pdfQuote(PATH, 2, WORDS);
const DAILY = periodicNote("daily", new Date()).path;
const NOTE = `## Dump\n\n${QUOTE}\n`;
/** Where the viewer's highlight keeps the take's ranges, by the name the stylesheet paints. */
const TAKEN = "kasten-taken";
/** The box a selection's rectangle is read in, which jsdom does not lay out. */
const RECT = { left: 100, top: 200, right: 160, bottom: 220, width: 60, height: 20 };

/** The hook's answer for the test's page, read at the moment it is needed. */
let pdf: ReturnType<typeof usePdfTake> | null = null;

/** A pdf's two pages, each with its text layer, and the text outside the pages. */
function Pdf() {
  const box = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const take = usePdfTake({ path: PATH, box, wrapper, archive: false });
  pdf = take;
  return (
    <>
      <section aria-label="pdf" tabIndex={-1} onKeyDown={(event) => void take.onKeyDown(event)}>
        <div ref={wrapper} className="relative">
          <div ref={box}>
            <div data-pdf-page="1">
              <div className="textLayer">
                <span>First page words. </span>
              </div>
            </div>
            <div data-pdf-page="2">
              <div className="textLayer">
                <span>{WORDS}</span>
              </div>
            </div>
            <div data-pdf-page="3">
              <div className="textLayer">
                <span>Three.</span>
              </div>
            </div>
          </div>
          {take.overlay}
        </div>
      </section>
      <p>Outside the pages.</p>
    </>
  );
}

/** Selects everything in `node` and tells the document, as the browser does on a drag. */
function select(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

/** Collapses the selection and tells the document, as a tap outside the words does. */
function collapse() {
  window.getSelection()?.removeAllRanges();
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

/** The words of page 2, as the viewer draws them. */
function pageTwo(): Node {
  return document.querySelector('[data-pdf-page="2"] .textLayer span') as Node;
}

/** The ranges the shared highlight holds, as the test's own fake keeps them. */
function marked(registry: Map<string, unknown>): Set<Range> {
  return (registry.get(TAKEN) ?? new Set()) as Set<Range>;
}

/** A fetch that answers every call with a sent dump, and records what it was asked. */
function answering() {
  const sent = vi.fn(async (_url: string, _init?: RequestInit) => {
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal("fetch", sent);
  return sent;
}

/** The bodies of the dumps that were posted, in the order they were sent. */
function dumpsSent(sent: ReturnType<typeof answering>) {
  return sent.mock.calls
    .filter(([url]) => url === "/api/dump")
    .map(([, init]) => JSON.parse(String(init?.body)) as { text: string; date: string });
}

/** Drop the outbox's database, which only goes once the outbox has let go of it. */
function dropped(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("kasten-outbox");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** The rectangle of a selection's last line, which jsdom has no layout to measure. */
let savedRects: PropertyDescriptor | undefined;

beforeEach(async () => {
  stubMatchMedia({});
  await reset();
  await dropped();
  fetchNote.mockResolvedValue("");
  saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
  searchNotes.mockResolvedValue([]);
  updateNote.mockResolvedValue(null);
  gate.hold = null;
  savedRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ ...RECT, x: RECT.left, y: RECT.top, toJSON: () => ({}) }],
  });
});

afterEach(() => {
  cleanup();
  pdf = null;
  if (savedRects) Object.defineProperty(Range.prototype, "getClientRects", savedRects);
  else delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("taking a passage out of a pdf", () => {
  it("a selection in a page shows the take button over it, with the page it is on", () => {
    render(<Pdf />);
    select(pageTwo());

    const button = screen.getByRole("button", { name: "Take the passage" });
    expect(within(button).getByText("page 2")).not.toBeNull();
  });

  it("y takes the passage into the dump under its pdf link, and the toast names the page", async () => {
    const sent = answering();
    render(<Pdf />);
    select(pageTwo());

    fireEvent.keyDown(pageTwo(), { key: "y" });

    await screen.findByRole("status");
    expect({
      text: dumpsSent(sent).map((dump) => dump.text),
      source: screen.getByText("page 2, report.pdf") !== null,
    }).toEqual({ text: [QUOTE], source: true });
  });

  it("a selection outside the pages shows no take button", () => {
    render(<Pdf />);
    select(screen.getByText("Outside the pages."));

    expect(screen.queryByRole("button", { name: "Take the passage" })).toBeNull();
  });

  it("a taken passage is marked in the shared highlight, and its Undo takes the mark off", async () => {
    const registry = new Map<string, unknown>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", Set);
    answering();
    fetchNote.mockResolvedValue(NOTE);
    saveNote.mockResolvedValue({ path: DAILY, content: "" });
    render(<Pdf />);
    select(pageTwo());

    fireEvent.keyDown(pageTwo(), { key: "y" });
    const undo = await screen.findByRole("button", { name: "Undo" });
    expect(marked(registry).size).toBe(1);
    fireEvent.click(undo);

    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    expect(saveNote).toHaveBeenCalledWith(
      DAILY,
      expect.not.stringContaining(QUOTE),
      false,
      noteBase(NOTE),
    );
    await waitFor(() => expect(marked(registry).size).toBe(0));
  });

  it("the mark of a taken passage is the words of its page, and a redrawn page gets it back", async () => {
    const registry = new Map<string, unknown>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", Set);
    answering();
    render(<Pdf />);
    select(pageTwo());

    fireEvent.keyDown(pageTwo(), { key: "y" });
    await screen.findByRole("status");
    expect([...marked(registry)].map((range) => range.toString())).toEqual([WORDS]);

    // The viewer draws page 2 again, with a new text layer that holds the same words.
    const page = document.querySelector('[data-pdf-page="2"]') as HTMLElement;
    const fresh = document.createElement("div");
    fresh.className = "textLayer";
    const span = document.createElement("span");
    span.textContent = WORDS;
    fresh.append(span);
    page.querySelector(".textLayer")?.replaceWith(fresh);
    act(() => pdf?.onText(2, fresh));

    const [again] = [...marked(registry)];
    expect({
      count: marked(registry).size,
      inNewLayer: again !== undefined && fresh.contains(again.startContainer),
      words: again?.toString(),
    }).toEqual({ count: 1, inNewLayer: true, words: WORDS });
  });

  it("a new pdf drops the held passage, the toast and the marks", async () => {
    const registry = new Map<string, unknown>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", Set);
    answering();
    render(<Pdf />);
    select(pageTwo());
    fireEvent.keyDown(pageTwo(), { key: "y" });
    await screen.findByRole("status");
    select(pageTwo());
    expect(screen.getByRole("button", { name: "Take the passage" })).not.toBeNull();

    act(() => pdf?.forget());

    expect({
      button: screen.queryByRole("button", { name: "Take the passage" }) !== null,
      toast: screen.queryByRole("status") !== null,
      marks: marked(registry).size,
    }).toEqual({ button: false, toast: false, marks: 0 });
  });

  it("a passage over many printed lines is one paragraph in the dump", async () => {
    const sent = answering();
    render(<Pdf />);
    // pdf.js puts a line break at each printed line end, so the selection's text has one per line.
    const lines = Array.from({ length: 60 }, (_, index) => `line ${index}`);
    pageTwo().textContent = lines.join("\n");
    select(pageTwo());

    fireEvent.keyDown(pageTwo(), { key: "y" });

    await screen.findByRole("status");
    expect(dumpsSent(sent).map((dump) => dump.text)).toEqual([
      `> ${lines.join(" ")}\n>\n> [[30 Research/report.pdf#page=2|report.pdf, page 2]]`,
    ]);
  });

  it("a selection from page 1 into page 2 links to page 1 and quotes the words of both", async () => {
    const sent = answering();
    render(<Pdf />);
    const first = document.querySelector('[data-pdf-page="1"] .textLayer span')?.firstChild as Text;
    const second = pageTwo().firstChild as Text;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, 3);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    fireEvent.keyDown(pageTwo(), { key: "y" });

    await screen.findByRole("status");
    expect(dumpsSent(sent).map((dump) => dump.text)).toEqual([
      "> First page words. Two\n>\n> [[30 Research/report.pdf#page=1|report.pdf, page 1]]",
    ]);
  });

  it("a press on the take button keeps the passage through the selection's collapse", async () => {
    const sent = answering();
    render(<Pdf />);
    select(pageTwo());
    const button = screen.getByRole("button", { name: "Take the passage" });

    fireEvent.pointerDown(button);
    collapse();
    expect(screen.queryByRole("button", { name: "Take the passage" })).not.toBeNull();
    fireEvent.click(button);

    await screen.findByRole("status");
    expect(dumpsSent(sent).map((dump) => dump.text)).toEqual([QUOTE]);
  });

  it("a press slid off the take button forgets the passage and the button goes", () => {
    answering();
    render(<Pdf />);
    select(pageTwo());
    const button = screen.getByRole("button", { name: "Take the passage" });

    fireEvent.pointerDown(button);
    collapse();
    fireEvent.pointerUp(button, { clientX: 900, clientY: 900 });

    expect(screen.queryByRole("button", { name: "Take the passage" })).toBeNull();
  });

  it("a take still in flight when a new pdf opens paints and records nothing on it", async () => {
    const registry = new Map<string, unknown>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", Set);
    answering();
    let release = () => {};
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(<Pdf />);
    select(pageTwo());
    fireEvent.keyDown(pageTwo(), { key: "y" });

    // The reader opens another pdf while the take is still being kept.
    act(() => pdf?.forget());
    release();

    await screen.findByRole("status");
    expect(marked(registry).size).toBe(0);
    // Nothing was recorded, so a page of the new pdf drawn now gets no mark either.
    const fresh = document.createElement("div");
    fresh.className = "textLayer";
    const span = document.createElement("span");
    span.textContent = WORDS;
    fresh.append(span);
    act(() => pdf?.onText(2, fresh));
    expect(marked(registry).size).toBe(0);
  });

  it("two takes in flight each mark their own words, and Undo of the second takes off only its own", async () => {
    const registry = new Map<string, unknown>();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", Set);
    answering();
    let release = () => {};
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchNote.mockResolvedValue(`## Dump\n\n${pdfQuote(PATH, 3, "Three.")}\n`);
    saveNote.mockResolvedValue({ path: DAILY, content: "" });
    render(<Pdf />);

    // Both takes start before either keep has resolved.
    select(pageTwo());
    fireEvent.keyDown(pageTwo(), { key: "y" });
    select(screen.getByText("Three."));
    fireEvent.keyDown(screen.getByText("Three."), { key: "y" });
    release();

    const undo = await screen.findByRole("button", { name: "Undo" });
    await waitFor(() => expect(marked(registry).size).toBe(2));
    expect([...marked(registry)].map((range) => range.toString()).sort()).toEqual(
      [WORDS, "Three."].sort(),
    );
    fireEvent.click(undo);

    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(marked(registry).size).toBe(1));
    expect([...marked(registry)].map((range) => range.toString())).toEqual([WORDS]);
  });
});
