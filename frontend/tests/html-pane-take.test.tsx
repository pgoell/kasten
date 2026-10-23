import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HtmlPane } from "@/components/html-pane";
import { readClock } from "@/lib/clock";
import { pageLink, takenQuote } from "@/lib/html-take";
import { noteBase } from "@/lib/note-base";
import { reset } from "@/lib/outbox";
import { hostLeader } from "@/lib/which-key";
import {
  answering,
  DAILY,
  dropped,
  dumpsSent,
  fromPage,
  NOTE,
  PASSAGE,
  PATH,
  QUOTE,
  READING,
  renderPane,
  selection,
  settled,
  takeButton,
  yFromPage,
} from "./html-pane-fixture";
import { stubMatchMedia } from "./match-media";
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

    await waitFor(() => expect(posted).toHaveBeenCalledWith({ kasten: "take", id: 1 }, "*"));
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
    await waitFor(() => expect(posted).toHaveBeenCalledWith({ kasten: "untake", id: 1 }, "*"));
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

  it("a new page in the pane drops the held passage and the toast", async () => {
    const sent = answering();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <HtmlPane path={PATH} commands={stubCommands()} onFocus={() => {}} />
      </QueryClientProvider>,
    );
    const frame = view.container.querySelector("iframe") as HTMLIFrameElement;

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    await screen.findByRole("status");
    fromPage(frame.contentWindow, selection());
    expect(takeButton()).not.toBeNull();

    // The same pane now shows another page, whose words the held passage is not.
    view.rerender(
      <QueryClientProvider client={client}>
        <HtmlPane path="31 Research/other.html" commands={stubCommands()} onFocus={() => {}} />
      </QueryClientProvider>,
    );
    yFromPage(frame);
    expect({
      button: takeButton() !== null,
      toast: screen.queryByRole("status") !== null,
      dumps: dumpsSent(sent).length,
    }).toEqual({ button: false, toast: false, dumps: 1 });

    // A reload of the frame drops a selection taken before it.
    fromPage(frame.contentWindow, selection());
    expect(takeButton()).not.toBeNull();
    fireEvent.load(frame);
    expect(takeButton()).toBeNull();
  });

  it("Undo of an earlier take asks the page to unmark that take's id", async () => {
    answering();
    const second = takenQuote(PATH, { ...PASSAGE, text: "Another passage." });
    fetchNote.mockResolvedValue(`## Dump\n\n${QUOTE}\n\n${second}\n`);
    saveNote.mockResolvedValue({ path: DAILY, content: "" });
    const { frame } = renderPane();
    const posted = vi
      .spyOn(frame.contentWindow as Window, "postMessage")
      .mockImplementation(() => {});

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    await screen.findByRole("button", { name: "Undo" });
    // The reader's own press takes the second passage, since the page's `y` already
    // took once in this visit.
    fromPage(frame.contentWindow, selection({ text: "Another passage." }));
    fireEvent.click(takeButton() as HTMLElement);
    await screen.findByText("Another passage.");
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    expect(posted.mock.calls.map(([message]) => message)).toEqual([
      { kasten: "take", id: 1 },
      { kasten: "take", id: 2 },
      { kasten: "untake", id: 2 },
    ]);
  });

  it("after a take, a later press slid off the button keeps the new passage", async () => {
    answering();
    const { frame } = renderPane();

    // A press that the page's collapse reached, and that then took the passage.
    frame.focus();
    fromPage(frame.contentWindow, selection());
    const first = takeButton();
    expect(first).not.toBeNull();
    fireEvent.pointerDown(first as HTMLElement);
    fromPage(frame.contentWindow, selection({ text: "", rect: null }));
    fireEvent.click(first as HTMLElement);
    await screen.findByRole("status");

    // A new passage, and a press on it that slides off before it is lifted.
    fromPage(frame.contentWindow, selection({ text: "Another passage." }));
    const second = takeButton();
    expect(second).not.toBeNull();
    fireEvent.pointerDown(second as HTMLElement);
    fireEvent.pointerUp(second as HTMLElement, { clientX: 900, clientY: 900 });

    expect(takeButton()).not.toBeNull();
  });

  it("a page that relays y twice in one visit takes only once", async () => {
    const sent = answering();
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    await screen.findByRole("status");
    fromPage(frame.contentWindow, selection({ text: "A second, forged passage." }));
    yFromPage(frame);
    await settled(() => dumpsSent(sent).length >= 2);

    expect(dumpsSent(sent)).toHaveLength(1);
  });

  it("a new visit to the page lets a relayed y take again", async () => {
    const sent = answering();
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    await screen.findByRole("status");
    fromPage(frame.contentWindow, selection({ text: "A second, forged passage." }));
    yFromPage(frame);
    await settled(() => dumpsSent(sent).length >= 2);
    expect(dumpsSent(sent)).toHaveLength(1);

    // The reader leaves the frame and comes back into it, which is a new visit.
    frame.focus();
    window.dispatchEvent(new Event("blur"));
    fromPage(frame.contentWindow, selection({ text: "A third passage." }));
    yFromPage(frame);
    await settled(() => dumpsSent(sent).length >= 2);

    expect(dumpsSent(sent)).toHaveLength(2);
    await screen.findByText("A third passage.");
  });

  it("the take button still takes after a relayed take", async () => {
    const sent = answering();
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    await screen.findByRole("status");
    fromPage(frame.contentWindow, selection({ text: "A second, forged passage." }));
    yFromPage(frame);
    await settled(() => dumpsSent(sent).length >= 2);
    expect(dumpsSent(sent)).toHaveLength(1);

    // The reader's own press takes what is held, whatever the page relayed.
    const button = takeButton();
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLElement);
    await settled(() => dumpsSent(sent).length >= 2);

    expect(dumpsSent(sent)).toHaveLength(2);
    await screen.findByText("A second, forged passage.");
  });

  it("Undo with no network says so in the toast", async () => {
    answering();
    fetchNote.mockResolvedValueOnce(NOTE).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await screen.findByText("No connection, so Undo left the note as it is");
    expect(saveNote).not.toHaveBeenCalled();
  });
});
