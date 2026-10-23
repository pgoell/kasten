import { addHighlight } from "@/lib/highlight";
import { withoutHighlight } from "@/lib/highlight-undo";
import { noteBase } from "@/lib/note-base";
import { undoFor, undoPassage } from "@/lib/page-undo";

const { fetchNote, saveNote } = vi.hoisted(() => ({ fetchNote: vi.fn(), saveNote: vi.fn() }));
vi.mock("@/lib/api", () => {
  // A class of its own, as the real one is, so `instanceof` in the undo answers the same.
  class ChangedOnDisk extends Error {}
  return { fetchNote, saveNote, ChangedOnDisk };
});

const NOTE = "20 Literature/DDIA.md";
const ID = "hl-a3f9c1";
const BASE = "# DDIA\n\n## Highlights\n";
const WRITTEN = addHighlight(BASE, { text: "A passage of the book.", chapter: "One" }, ID);

beforeEach(() => {
  saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("a book's take, undone", () => {
  it("takes its one block out under the base the note had when the take was read", async () => {
    fetchNote.mockResolvedValue(WRITTEN);
    const undo = await undoFor(NOTE, ID, 1, withoutHighlight);
    if (undo === undefined) throw new Error("the take should be undoable");

    const outcome = await undoPassage(undo, withoutHighlight);

    expect({ outcome, saved: saveNote.mock.calls }).toEqual({
      outcome: { state: "undone" },
      saved: [[NOTE, BASE, false, noteBase(WRITTEN)]],
    });
  });

  it("refuses and writes nothing when the book's note changed since the take", async () => {
    fetchNote.mockResolvedValueOnce(WRITTEN).mockResolvedValue(`${WRITTEN}\nWritten meanwhile.\n`);
    const undo = await undoFor(NOTE, ID, 1, withoutHighlight);
    if (undo === undefined) throw new Error("the take should be undoable");

    const outcome = await undoPassage(undo, withoutHighlight);

    expect({ outcome, saved: saveNote.mock.calls.length }).toEqual({
      outcome: { state: "refused" },
      saved: 0,
    });
  });
});
