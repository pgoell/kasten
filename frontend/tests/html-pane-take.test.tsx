import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HtmlPane } from "@/components/html-pane";
import { readClock } from "@/lib/clock";
import { pageLink, takenQuote } from "@/lib/html-take";
import { noteBase } from "@/lib/note-base";
import { reset } from "@/lib/outbox";
import { periodicNote } from "@/lib/periodic";
import { hostLeader } from "@/lib/which-key";
import { COARSE, stubMatchMedia } from "./match-media";
import { stubCommands } from "./stub-commands";

const { fetchNote, saveNote, updateNote, searchNotes } = vi.hoisted(() => ({
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
  updateNote: vi.fn(),
  searchNotes: vi.fn(),
}));
vi.mock("@/lib/api", () => {
  // A class of its own, as the real one is, so `instanceof` in the pane answers the same.
  class ChangedOnDisk extends Error {}
  return { fetchNote, saveNote, updateNote, searchNotes, ChangedOnDisk };
});

// The take goes through the real outbox, which keeps the dump in IndexedDB.
// Its stand-in is the one the capture route's tests use.

const PATH = "30 Research/report.html";
const PASSAGE = { text: "A passage of the report.", heading: "Results", anchor: "results" };
const RECT = { left: 100, top: 100, right: 160, bottom: 120 };
const READING = "00 Notes/Reading.md";

/** The dump the take writes, and the daily note's text with it in its `## Dump`. */
const QUOTE = takenQuote(PATH, PASSAGE);
const DAILY = periodicNote("daily", new Date()).path;
const NOTE = `## Dump\n\n${QUOTE}\n`;

/** Drop the outbox's database, which only goes once the outbox has let go of it. */
function dropped(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("kasten-outbox");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** A message as the window hears it, from `source`, the way a page's script posts one. */
function fromPage(source: Window | null, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

/** What the page sends for a selection, with the fields the test does not name. */
function selection(over: Record<string, unknown> = {}) {
  return {
    kasten: "selection",
    text: PASSAGE.text,
    heading: PASSAGE.heading,
    anchor: PASSAGE.anchor,
    rect: RECT,
    ...over,
  };
}

/** The DOMRect a measured element answers with, which jsdom leaves as zeros. */
function boxAt(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
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

/** The pane, wrapped for the queries the toast's note list makes. */
function renderPane(path = PATH, props: { archive?: boolean; anchor?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <HtmlPane path={path} {...props} commands={stubCommands()} onFocus={() => {}} />
    </QueryClientProvider>,
  );
  const frame = view.container.querySelector("iframe") as HTMLIFrameElement;
  const section = view.container.querySelector("[data-html-pane]") as HTMLElement;
  return { frame, section };
}

/** The take button, as a reader finds it. */
function takeButton() {
  return screen.queryByRole("button", { name: "Take the passage" });
}

/** Presses `y` from the page, the frame having the focus. */
function yFromPage(frame: HTMLIFrameElement) {
  fromPage(frame.contentWindow, { kasten: "key", key: "y" });
}

/**
 * Lets the take finish, which runs through IndexedDB: the answer comes on the
 * next macrotask, so the test waits for a macrotask at a time, a bounded number.
 */
async function settled(done: () => boolean) {
  for (let turn = 0; turn < 200 && !done(); turn++) {
    await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
  }
}

beforeEach(async () => {
  localStorage.clear();
  stubMatchMedia({});
  await reset();
  await dropped();
  fetchNote.mockResolvedValue("");
  saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
  searchNotes.mockResolvedValue([]);
  updateNote.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  // Puts back the measured sizes the tests spy on, which `resetAllMocks` keeps.
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("taking a passage out of an html page", () => {
  it("a selection from the focused frame shows the button with the heading and the y hint", () => {
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());

    const button = takeButton();
    expect({
      present: button !== null,
      heading: button !== null && within(button).getByText("Results").textContent,
      hint: button !== null && within(button).getByText("y").textContent,
    }).toEqual({ present: true, heading: "Results", hint: "y" });
  });

  it("a selection while the frame is not focused shows nothing", () => {
    const { frame } = renderPane();

    fromPage(frame.contentWindow, selection());
    expect(takeButton()).toBeNull();

    // The same selection once the frame holds the focus is shown, so the nothing
    // above was the focus and not the message.
    frame.focus();
    fromPage(frame.contentWindow, selection());
    expect(takeButton()).not.toBeNull();
  });

  it("an empty selection takes the button away", () => {
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    expect(takeButton()).not.toBeNull();

    fromPage(frame.contentWindow, selection({ text: "", heading: "", rect: null }));
    expect(takeButton()).toBeNull();
  });

  it("a selection from another window shows nothing", () => {
    const { frame } = renderPane();
    // A frame nested in the page would be another window, as would one the page opened.
    const nested = document.createElement("iframe");
    document.body.appendChild(nested);

    frame.focus();
    for (const source of [nested.contentWindow, window, null]) {
      fromPage(source, selection());
    }
    expect(takeButton()).toBeNull();

    // The same message from the frame itself is heard.
    fromPage(frame.contentWindow, selection());
    expect(takeButton()).not.toBeNull();
    nested.remove();
  });

  it("malformed selection messages throw nothing and show nothing", () => {
    const { frame } = renderPane();
    const errors = vi.fn();
    window.addEventListener("error", errors);

    frame.focus();
    for (const data of [
      { kasten: "selection" },
      selection({ text: 5 }),
      selection({ heading: undefined }),
      selection({ rect: 5 }),
      selection({ rect: { left: "1", top: 0, right: 1, bottom: 1 } }),
      selection({ rect: { left: Number.NaN, top: 0, right: 1, bottom: 1 } }),
      null,
      "selection",
    ]) {
      fromPage(frame.contentWindow, data);
    }

    expect({ button: takeButton() !== null, errors: errors.mock.calls.length }).toEqual({
      button: false,
      errors: 0,
    });

    // A well-formed selection after them is shown, so the nothing above was the malformed.
    fromPage(frame.contentWindow, selection());
    expect(takeButton()).not.toBeNull();
    window.removeEventListener("error", errors);
  });

  it("a click on the button keeps the passage through the press and takes it into the dump", async () => {
    const sent = answering();
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    const button = takeButton();
    expect(button).not.toBeNull();
    fireEvent.pointerDown(button as HTMLElement);
    // The page's collapse arrives while the finger is down, and must not take the button away.
    fromPage(frame.contentWindow, selection({ text: "", rect: null }));
    expect(takeButton()).not.toBeNull();

    fireEvent.click(button as HTMLElement);

    await screen.findByRole("status");
    expect(dumpsSent(sent)).toEqual([
      { text: QUOTE, date: readClock(new Date()).date, id: expect.any(String) },
    ]);
  });

  it("y from the page takes the passage into the dump through the outbox", async () => {
    const sent = answering();
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);

    await screen.findByRole("status");
    expect(dumpsSent(sent)[0]?.text).toBe(QUOTE);
  });

  it("y pressed in the pane takes the passage into the dump", async () => {
    const sent = answering();
    const { frame, section } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    section.focus();
    fireEvent.keyDown(section, { key: "y" });

    await screen.findByRole("status");
    expect(dumpsSent(sent)[0]?.text).toBe(QUOTE);
  });

  it("the page is told the passage is taken once it is kept", async () => {
    answering();
    const { frame } = renderPane();
    const posted = vi
      .spyOn(frame.contentWindow as Window, "postMessage")
      .mockImplementation(() => {});

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);

    await waitFor(() => expect(posted).toHaveBeenCalledWith({ kasten: "take" }, "*"));
    expect(takeButton()).toBeNull();
    // The toast is the last thing a take does, so it is awaited before the test ends.
    await screen.findByRole("status");
  });

  it("the toast shows its title, the passage and the source, and fades after five seconds", async () => {
    answering();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    await settled(() => screen.queryByRole("status") !== null);

    const toast = screen.getByRole("status");
    expect({
      title: within(toast).getByText("Taken into today's dump") !== null,
      passage: within(toast).getByText(PASSAGE.text) !== null,
      source: within(toast).getByText("Results, report.html") !== null,
      faded: toast.classList.contains("opacity-0"),
    }).toEqual({ title: true, passage: true, source: true, faded: false });

    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("status").classList.contains("opacity-0")).toBe(true);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Undo takes the dump line out of the daily note with a conditional write and tells the page", async () => {
    answering();
    fetchNote.mockResolvedValue(NOTE);
    saveNote.mockResolvedValue({ path: DAILY, content: "" });
    const { frame } = renderPane();
    const posted = vi
      .spyOn(frame.contentWindow as Window, "postMessage")
      .mockImplementation(() => {});

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    expect(saveNote).toHaveBeenCalledWith(
      DAILY,
      expect.not.stringContaining(QUOTE),
      false,
      noteBase(NOTE),
    );
    await waitFor(() => expect(posted).toHaveBeenCalledWith({ kasten: "untake" }, "*"));
  });

  it("Undo refuses when the daily note changed since the take and writes nothing", async () => {
    answering();
    fetchNote.mockResolvedValueOnce(NOTE).mockResolvedValue(`${NOTE}\nWritten meanwhile.\n`);
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await screen.findByText("The daily note changed since, so Undo left it as it is");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("a take that waits in the outbox says so and offers no Undo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);

    await screen.findByText("Taken, waiting to send (1 waiting)");
    expect({
      undo: screen.queryByRole("button", { name: "Undo" }),
      read: fetchNote.mock.calls.length,
    }).toEqual({ undo: null, read: 0 });
  });

  it("Put it in a note writes the passage under Highlights of the note picked", async () => {
    answering();
    searchNotes.mockResolvedValue([{ path: READING, line: 1, text: "modified: 2026-10-20T10:00" }]);
    updateNote.mockResolvedValue({ path: READING, content: "" });
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    fireEvent.click(await screen.findByRole("button", { name: "Put it in a note" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reading" }));

    await screen.findByText("Put into Reading");
    expect(updateNote).toHaveBeenCalledWith(READING, expect.any(Function));
    const change = updateNote.mock.calls[0]?.[1] as (text: string) => string;
    const written = change("# Reading\n");
    expect({
      section: written.includes("## Highlights"),
      chapter: written.includes(pageLink(PATH, PASSAGE)),
    }).toEqual({ section: true, chapter: true });
  });

  it("with the which-key panel open, y takes nothing", async () => {
    const sent = answering();
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    fromPage(frame.contentWindow, { kasten: "key", key: " " });
    expect(spy).toHaveBeenCalledTimes(1);

    // The panel holds the focus, so the frame is not the active element and its keys are not heard.
    const panel = document.createElement("button");
    document.body.appendChild(panel);
    panel.focus();
    yFromPage(frame);
    fireEvent.keyDown(panel, { key: "y" });
    expect({ dumps: dumpsSent(sent).length, held: takeButton() !== null }).toEqual({
      dumps: 0,
      held: true,
    });

    // With the focus back on the frame, the same key takes, so the nothing above was the panel.
    panel.remove();
    off();
    frame.focus();
    yFromPage(frame);
    await screen.findByRole("status");
    expect(dumpsSent(sent)).toHaveLength(1);
  });

  it("in a split each pane's button answers only its own frame", () => {
    const view = render(
      <>
        <HtmlPane path="a.html" commands={stubCommands()} onFocus={() => {}} />
        <HtmlPane path="b.html" commands={stubCommands()} onFocus={() => {}} />
      </>,
    );
    const frames = view.container.querySelectorAll("iframe");
    const frameA = frames[0] as HTMLIFrameElement;
    const frameB = frames[1] as HTMLIFrameElement;
    const panes = view.container.querySelectorAll<HTMLElement>("[data-html-pane]");
    const paneA = panes[0] as HTMLElement;
    const paneB = panes[1] as HTMLElement;

    frameB.focus();
    fromPage(frameB.contentWindow, selection());
    // A message from the other frame, which has no selection of its own, reaches nothing here.
    fromPage(frameA.contentWindow, selection({ text: "", rect: null }));

    expect({
      inA: within(paneA).queryByRole("button", { name: "Take the passage" }) !== null,
      inB: within(paneB).queryByRole("button", { name: "Take the passage" }) !== null,
    }).toEqual({ inA: false, inB: true });
  });

  it("the button sits above the words on a fine pointer", () => {
    const { frame } = renderPane();
    const wrapper = frame.parentElement as HTMLElement;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(boxAt(0, 50, 600, 400));
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(boxAt(0, 50, 600, 400));

    frame.focus();
    fromPage(frame.contentWindow, selection());

    const button = takeButton();
    expect({
      left: button?.style.left,
      top: button?.style.top,
      above: button?.classList.contains("-translate-y-full"),
    }).toEqual({ left: "130px", top: "100px", above: true });
  });

  it("the button sits below the words on a touch screen, clear of the phone's menu", () => {
    stubMatchMedia({ [COARSE]: true });
    const { frame } = renderPane();
    const wrapper = frame.parentElement as HTMLElement;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(boxAt(0, 50, 600, 400));
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(boxAt(0, 50, 600, 400));

    frame.focus();
    fromPage(frame.contentWindow, selection());

    const button = takeButton();
    expect({
      left: button?.style.left,
      top: button?.style.top,
      above: button?.classList.contains("-translate-y-full"),
    }).toEqual({ left: "130px", top: "152px", above: false });
  });

  it("the button is kept inside the frame when the words sit at its top left corner", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(157);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    const { frame } = renderPane();
    const wrapper = frame.parentElement as HTMLElement;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(boxAt(0, 50, 600, 400));
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(boxAt(0, 50, 600, 400));

    frame.focus();
    fromPage(frame.contentWindow, selection({ rect: { left: 0, top: 0, right: 10, bottom: 10 } }));

    // Half its width in from the left, and its full height down from the top.
    const button = takeButton();
    expect({ left: button?.style.left, top: button?.style.top }).toEqual({
      left: "78.5px",
      top: "24px",
    });
  });

  it("a wide button near the left edge stays inside the frame", () => {
    // A 157px button, as the heading makes it, centred on a selection 66px from the left.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(157);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    const { frame } = renderPane();
    const wrapper = frame.parentElement as HTMLElement;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(boxAt(0, 50, 600, 400));
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(boxAt(0, 50, 600, 400));

    frame.focus();
    fromPage(
      frame.contentWindow,
      selection({ rect: { left: 46, top: 100, right: 86, bottom: 120 } }),
    );

    const button = takeButton();
    expect(Number.parseFloat(button?.style.left ?? "") - 157 / 2).toBeGreaterThanOrEqual(0);
  });

  it("opens the frame at the heading a link named, in the pane's own anchor", () => {
    const { frame } = renderPane(PATH, { anchor: "the paper" });

    expect(frame.getAttribute("src")?.endsWith("#the%20paper")).toBe(true);
  });
});
