import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useBookNoteTake } from "@/components/use-book-note-take";
import { addHighlight, type Passage } from "@/lib/highlight";
import { noteBase } from "@/lib/note-base";
import { BOOK_REFUSED } from "@/lib/page-undo";

const { fetchNote, saveNote, updateNote, searchNotes } = vi.hoisted(() => ({
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
  updateNote: vi.fn(),
  searchNotes: vi.fn(),
}));
vi.mock("@/lib/api", () => {
  class ChangedOnDisk extends Error {}
  return { fetchNote, saveNote, updateNote, searchNotes, ChangedOnDisk };
});

const NOTE = "20 Literature/DDIA.md";
const ID = "hl-a3f9c1";
const BASE = "# DDIA\n\n## Highlights\n";
const PASSAGE: Passage = { text: "A passage of the book.", chapter: "One" };
const WRITTEN = addHighlight(BASE, PASSAGE, ID);

/** The hook's answer for the test's component, read at the moment it is needed. */
let book: ReturnType<typeof useBookNoteTake> | null = null;

function Taker({ note, onTake }: { note: string; onTake: () => Promise<string | null> }) {
  const hook = useBookNoteTake({ note, archive: false, onTake });
  book = hook;
  return <div>{hook.toast}</div>;
}

/** The take's pane, with the query client its note column and Undo share. */
function renderTaker(onTake: () => Promise<string | null>, note = NOTE) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<Taker note={note} onTake={onTake} />, { wrapper });
  return { invalidate };
}

/** Takes the passage from the test, without waiting: the answer is read off the page. */
function takeIt() {
  act(() => void book?.take(PASSAGE, false));
}

/** Lets the take run to its end, a bounded number of macrotasks at a time. */
async function settled() {
  for (let turn = 0; turn < 50; turn++) {
    await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
  }
}

afterEach(() => {
  cleanup();
  book = null;
  vi.resetAllMocks();
});

beforeEach(() => {
  fetchNote.mockResolvedValue(WRITTEN);
  saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
  searchNotes.mockResolvedValue([]);
  updateNote.mockResolvedValue(null);
});

describe("the book's note take", () => {
  it("shows the toast with Undo; Undo takes the block out and invalidates the note", async () => {
    fetchNote.mockResolvedValue(WRITTEN);
    const { invalidate } = renderTaker(async () => ID);

    takeIt();
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    expect({
      saved: saveNote.mock.calls[0],
      invalidated: invalidate.mock.calls.filter(([f]) => f?.queryKey?.[0] === "note"),
    }).toEqual({
      saved: [NOTE, BASE, false, noteBase(WRITTEN)],
      invalidated: [[{ queryKey: ["note", NOTE] }]],
    });
  });

  it("Undo refuses with the book's words when the note changed since the take, and writes nothing", async () => {
    fetchNote.mockResolvedValueOnce(WRITTEN).mockResolvedValue(`${WRITTEN}\nWritten meanwhile.\n`);
    renderTaker(async () => ID);

    takeIt();
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await screen.findByText(BOOK_REFUSED);
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("a take whose write lands after the pane opened another book shows no toast", async () => {
    let land = (_id: string | null) => {};
    const landed = new Promise<string | null>((resolve) => {
      land = resolve;
    });
    renderTaker(() => landed);

    takeIt();
    act(() => book?.forget());
    land(ID);
    await settled();

    expect({
      toast: screen.queryByRole("status") !== null,
      read: fetchNote.mock.calls.length,
    }).toEqual({ toast: false, read: 0 });
  });

  it("a take the write refused shows no toast and reads nothing back", async () => {
    renderTaker(async () => null);

    takeIt();
    await settled();

    expect({
      toast: screen.queryByRole("status") !== null,
      read: fetchNote.mock.calls.length,
    }).toEqual({ toast: false, read: 0 });
  });

  it("Put it in a note writes the passage with the link back to its highlight", async () => {
    fetchNote.mockResolvedValue(WRITTEN);
    searchNotes.mockResolvedValue([
      { path: "30 Notes/Pick.md", line: 2, text: "modified: 2026-10-23T10:00" },
    ]);
    renderTaker(async () => ID);

    takeIt();
    fireEvent.click(await screen.findByRole("button", { name: "Put it in a note" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pick" }));

    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(1));
    const change = updateNote.mock.calls[0]?.[1] as (text: string) => string;
    expect({ path: updateNote.mock.calls[0]?.[0], written: change("# Pick\n") }).toEqual({
      path: "30 Notes/Pick.md",
      written: expect.stringMatching(
        /^# Pick\n\n## Highlights\n\n> A passage of the book\.\n\n\[\[20 Literature\/DDIA#\^hl-a3f9c1\|One\]\] \^hl-[0-9a-f]{6}\n$/,
      ),
    });
  });

  it("Put it in a note links back with the markdown link for a book whose name holds a bracket", async () => {
    const odd = "20 Literature/a]]b.md";
    fetchNote.mockResolvedValue(addHighlight(BASE, PASSAGE, ID));
    searchNotes.mockResolvedValue([
      { path: "30 Notes/Pick.md", line: 2, text: "modified: 2026-10-23T10:00" },
    ]);
    renderTaker(async () => ID, odd);

    takeIt();
    fireEvent.click(await screen.findByRole("button", { name: "Put it in a note" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pick" }));

    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(1));
    const change = updateNote.mock.calls[0]?.[1] as (text: string) => string;
    expect(change("# Pick\n")).toContain("[One](../20%20Literature/a%5D%5Db.md#^hl-a3f9c1) ^hl-");
  });
});
