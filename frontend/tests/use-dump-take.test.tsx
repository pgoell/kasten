import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type Taking, useDumpTake } from "@/components/use-dump-take";
import { readClock } from "@/lib/clock";
import { noteBase } from "@/lib/note-base";
import { reset } from "@/lib/outbox";
import { pdfLink, pdfQuote } from "@/lib/pdf-take";
import { periodicNote } from "@/lib/periodic";

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

// The take goes through the real outbox, which keeps the dump in IndexedDB.

const PATH = "30 Research/report.pdf";
const TAKING: Taking = {
  quote: pdfQuote(PATH, 2, "A passage of the report."),
  text: "A passage of the report.",
  link: pdfLink(PATH, 2),
  source: "page 2, report.pdf",
  top: false,
};

/** The dump the take writes, and the daily note's text with it in its `## Dump`. */
const QUOTE = TAKING.quote;
const DAILY = periodicNote("daily", new Date()).path;
const NOTE = `## Dump\n\n${QUOTE}\n`;
const REFUSED = "The daily note changed since, so Undo left it as it is";

/** Drop the outbox's database, which only goes once the outbox has let go of it. */
function dropped(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("kasten-outbox");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
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

/**
 * Lets the take finish, which runs through IndexedDB: the answer comes on the
 * next macrotask, so the test waits for a macrotask at a time, a bounded number.
 */
async function settled(done: () => boolean) {
  for (let turn = 0; turn < 200 && !done(); turn++) {
    await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
  }
}

/** The hook's answer for the test's component, read at the moment it is needed. */
let dump: ReturnType<typeof useDumpTake> | null = null;

function Taker({
  onMarked,
  onUnmarked,
}: {
  onMarked: (id: number) => void;
  onUnmarked: (id: number) => void;
}) {
  const hook = useDumpTake({ archive: false, onMarked, onUnmarked });
  dump = hook;
  return <div>{hook.toast}</div>;
}

/** Takes the passage from the test, without waiting: the answer is read off the page. */
function takeIt() {
  return dump?.take(TAKING);
}

beforeEach(async () => {
  await reset();
  await dropped();
  fetchNote.mockResolvedValue("");
  saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
  searchNotes.mockResolvedValue([]);
  updateNote.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  dump = null;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("the dump take a pane shares", () => {
  it("a take keeps the passage through the outbox, sends it, and marks it once kept", async () => {
    const sent = answering();
    const onMarked = vi.fn();
    render(<Taker onMarked={onMarked} onUnmarked={() => {}} />);

    act(() => void takeIt());
    await settled(() => onMarked.mock.calls.length > 0 && dumpsSent(sent).length > 0);

    expect({ marked: onMarked.mock.calls, sent: dumpsSent(sent) }).toEqual({
      marked: [[1]],
      sent: [{ text: QUOTE, date: readClock(new Date()).date, id: expect.any(String) }],
    });
    // The toast is the last thing a take does, so it is awaited before the test ends.
    await screen.findByRole("status");
  });

  it("the toast says the take is in today's dump, and its Undo takes the line out and unmarks it", async () => {
    answering();
    fetchNote.mockResolvedValue(NOTE);
    saveNote.mockResolvedValue({ path: DAILY, content: "" });
    const onUnmarked = vi.fn();
    render(<Taker onMarked={() => {}} onUnmarked={onUnmarked} />);

    act(() => void takeIt());
    await screen.findByText("Taken into today's dump");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    expect(saveNote).toHaveBeenCalledWith(
      DAILY,
      expect.not.stringContaining(QUOTE),
      false,
      noteBase(NOTE),
    );
    await waitFor(() => expect(onUnmarked).toHaveBeenCalledWith(1));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Undo refuses when the daily note changed since the take, writes nothing and unmarks nothing", async () => {
    answering();
    fetchNote.mockResolvedValueOnce(NOTE).mockResolvedValue(`${NOTE}\nWritten meanwhile.\n`);
    const onUnmarked = vi.fn();
    render(<Taker onMarked={() => {}} onUnmarked={onUnmarked} />);

    act(() => void takeIt());
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await screen.findByText(REFUSED);
    expect({ saved: saveNote.mock.calls.length, unmarked: onUnmarked.mock.calls.length }).toEqual({
      saved: 0,
      unmarked: 0,
    });
  });
});
