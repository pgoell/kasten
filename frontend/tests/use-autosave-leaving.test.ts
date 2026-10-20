import { act } from "@testing-library/react";
import { heldText, holdText, moveHeld } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  eachPage,
  idle,
  pendingSave,
  refused,
  renderAutosave,
  settled,
  written,
} from "./autosave-fixture";

const { saveNote, fetchNote } = vi.hoisted(() => ({ saveNote: vi.fn(), fetchNote: vi.fn() }));
// The real refusal, which the hook tells apart from every other failure.
vi.mock("@/lib/api", async (importOriginal) => ({
  saveNote,
  fetchNote,
  ChangedOnDisk: (await importOriginal<typeof import("@/lib/api")>()).ChangedOnDisk,
}));

describe("useAutosave", () => {
  eachPage();

  it("says a write is in the air for the note it was typed into", async () => {
    // Off a count of its own and not off `pending`, which `save` empties on the
    // way out: a note whose text is between the keyboard and the disk would
    // otherwise read as clean.
    const note = renderAutosave();
    const write = pendingSave();

    note.change("# edited");
    await idle();
    expect(note.isWriting("index.md")).toBe(true);

    await write.finish();

    expect(note.isWriting("index.md")).toBe(false);
  });

  it("counts the writes rather than flagging them", async () => {
    // `:w` during a quiet write puts two in the air for one note, and the first
    // to answer must not read as the last. A flag passes every other case here.
    const note = renderAutosave();
    const quiet = pendingSave();
    const asked = pendingSave();

    note.change("# edited");
    await idle();
    note.change("# edited again");
    note.startSave();
    await quiet.finish();
    // `:w` goes out once the quiet write lands, naming its hash.
    await settled();
    expect(note.isWriting("index.md")).toBe(true);

    await asked.finish();

    expect(note.isWriting("index.md")).toBe(false);
  });

  it("answers about the note named, not about the one it is following", async () => {
    // The tail this exists for: moving to another pane flushes the note being
    // left, and the hook's own path has moved on while that write is still out.
    const note = renderAutosave("index.md");
    const write = pendingSave();

    note.change("# edited");
    note.open("daily/2026-08-05.md");

    expect(note.isWriting("index.md")).toBe(true);
    expect(note.isWriting("daily/2026-08-05.md")).toBe(false);
    await write.finish();
    expect(note.isWriting("index.md")).toBe(false);
  });

  it("says nothing is in the air after a write that failed on discarded text", async () => {
    // The failure arm returns early once the reader has thrown the text away,
    // so a count lowered at the end of it leaks for the life of the page and
    // that note is never bookmarked again.
    const note = renderAutosave();
    const write = pendingSave();

    note.change("# edited");
    await idle();
    note.revert(true);
    await write.break();

    expect(note.isWriting("index.md")).toBe(false);
  });
  it("names the new note's own save as its base when the old note's flush answers late", async () => {
    // The flush of the note left behind answers with the closure of that note,
    // after the hook already follows the next one. Taking `onDisk` there would
    // name the old note's text as the new one's base, and the vault refuses.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.change("# daily");
    await note.save();
    await flush.finish();
    note.change("# daily more");
    await idle();

    expect(saveNote).toHaveBeenLastCalledWith(
      "daily/2026-08-05.md",
      "# daily more",
      false,
      noteBase(written("# daily").content),
    );
    expect(note.status()).toBe("saved");
  });

  it("leaves the next note alone when the old note's flush fails and it is left untouched", async () => {
    // The failure arm used to keep the text for a retry, but the retry runs
    // with the next note's closure: the old note's words would land in it.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    await flush.break();
    note.unmount();

    expect(saveNote).toHaveBeenCalledOnce();
    expect(saveNote).toHaveBeenCalledWith("index.md", "# left behind");
  });

  it("leaves the next note alone when the old note's flush fails and it is saved", async () => {
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    await flush.break();
    await note.save();

    expect(saveNote).toHaveBeenCalledOnce();
    expect(saveNote).not.toHaveBeenCalledWith("daily/2026-08-05.md", expect.anything());
  });

  it("holds the left note's text when the flush on the way out fails", async () => {
    // The held list in the bar reports it; the note on screen is not the one
    // whose text the vault refused, so its own reading stays its own.
    const note = renderAutosave("index.md");
    saveNote.mockRejectedValueOnce(new Error("failed with 500"));

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    expect(heldText("index.md")).toEqual({
      content: "# left behind",
      reason: "failed with 500",
      conflicted: false,
    });
    expect(note.status()).toBe("saved");
    expect(note.reason()).toBeUndefined();
  });

  it("still holds the left note's text when the next note was reverted meanwhile", async () => {
    // `:e!` on the next note throws away that note's text, not the old one's.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.revert(true);
    await flush.break();

    expect(heldText("index.md")?.content).toBe("# left behind");
  });

  it("keeps the next note's own failure alone when the old note's flush fails", async () => {
    // The next note's text is still waiting and `:w` would write it, so the
    // bar must go on offering that, its reason the next note's alone.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    saveNote.mockRejectedValueOnce(new Error("PUT /api/files/daily/2026-08-05.md failed with 500"));
    note.change("# daily");
    await idle();
    expect(note.status()).toBe("error");
    await flush.break();

    expect(note.status()).toBe("error");
    expect(note.reason()).toBe("PUT /api/files/daily/2026-08-05.md failed with 500");
    expect(heldText("index.md")?.content).toBe("# left behind");
  });

  it("keeps the next note's conflict alone when the old note's flush fails", async () => {
    // The conflict holds every write back, so a bar reading `error` instead
    // would hide the one thing the reader has to settle with `:w`.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.change("# daily");
    await refused();
    await flush.break();

    expect(note.status()).toBe("conflict");
    expect(heldText("index.md")?.content).toBe("# left behind");
  });

  it("keeps the left note's held text through a save in the next note", async () => {
    const note = renderAutosave("index.md");
    saveNote.mockRejectedValueOnce(new Error("failed with 500"));

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    await act(async () => {});
    note.change("# daily");
    await idle();

    expect(saveNote).toHaveBeenLastCalledWith("daily/2026-08-05.md", "# daily");
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")?.content).toBe("# left behind");
  });

  it("holds the text when the flush on unmount fails", async () => {
    // Leaving the editor route unmounts the hook with the visit unchanged, so
    // the failure lands in the arm for the note on screen, with nobody left.
    const note = renderAutosave("index.md");
    saveNote.mockRejectedValueOnce(new Error("failed with 502"));

    note.change("# typed");
    note.unmount();
    await act(async () => {});

    expect(heldText("index.md")).toEqual({
      content: "# typed",
      reason: "failed with 502",
      conflicted: false,
    });
  });

  it("holds a write that fails after its note moved under the new path", async () => {
    // The route follows a move with `moveHeld` and opens the note at its new
    // path, both before the write in the air answers.
    const note = renderAutosave("index.md");
    const write = pendingSave();

    note.change("# edited");
    await idle();
    moveHeld((path) => (path === "index.md" ? "moved.md" : undefined));
    note.open("moved.md");
    await write.break();

    expect(heldText("index.md")).toBeUndefined();
    expect(heldText("moved.md")).toMatchObject({ content: "# edited" });
  });

  it("drops the held entry a move carried when the write in the air lands", async () => {
    const note = renderAutosave("index.md");
    const write = pendingSave();

    // What a hide holds of a quiet write still in the air.
    holdText("index.md", { content: "# edited", reason: "hidden", conflicted: false });
    note.change("# edited");
    await idle();
    moveHeld((path) => (path === "index.md" ? "moved.md" : undefined));
    note.open("moved.md");
    await write.finish();

    expect(heldText("moved.md")).toBeUndefined();
  });
});
