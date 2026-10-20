import { act } from "@testing-library/react";
import { ChangedOnDisk } from "@/lib/api";
import { heldText, holdText, moveHeld } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  eachPage,
  heldRows,
  idle,
  pagehide,
  pendingSave,
  refusedLater,
  renderAutosave,
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

  it("reopens held text as an error, not a conflict, when the last write landed while typing went on", async () => {
    const left = renderAutosave("index.md");
    left.seed("index.md", "the index note");
    const first = pendingSave();
    left.change("a");
    await idle();
    left.change("ab");
    await first.finish();
    // The cache still holds the note from before the write, which landed.
    expect(left.cached("index.md")).toBe("the index note");
    saveNote.mockRejectedValue(new TypeError("Failed to fetch"));
    await pagehide();
    left.unmount();
    await act(async () => {});

    const note = renderAutosave("index.md");
    expect(note.allowReload(written("a").content)).toBe(false);

    expect(note.status()).toBe("error");
  });

  it("drops held text when the flush on leaving carries it", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");
    note.allowReload("the index note");

    note.change("# held new");
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    expect(saveNote).toHaveBeenLastCalledWith("index.md", "# held new");
    expect(heldText("index.md")).toBeUndefined();
  });

  it("keeps text held at hide time when an older write lands", async () => {
    const note = renderAutosave("index.md");
    const older = pendingSave();
    note.change("c1");
    await idle();
    // The keepalive that never answers: the page went away under it.
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    note.change("c2");
    await pagehide();

    await older.finish();

    expect(heldText("index.md")?.content).toBe("c2");
  });

  it("keeps text held at hide time when an older write fails", async () => {
    const note = renderAutosave("index.md");
    const older = pendingSave();
    note.change("c1");
    await idle();
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    note.change("c2");
    await pagehide();

    await older.break();

    expect(heldText("index.md")?.content).toBe("c2");
    // Nor does the older text come back into `pending` to be written later.
    await note.save();
    expect(saveNote).not.toHaveBeenLastCalledWith("index.md", "c1");
  });

  it("keeps both texts when a flush refused after the reopen is followed by a refused save", async () => {
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");
    const refuseFlush = refusedLater();

    note.change("# T1");
    note.open("other.md");
    // Back before the flush answers, on a buffer still holding the vault's
    // text. The read of that text is from before the flush, and declined (#304).
    note.open("index.md");
    expect(note.allowReload("the index note")).toBe(false);
    await refuseFlush();
    note.change("# T2");
    saveNote.mockRejectedValueOnce(new ChangedOnDisk());
    await note.save();

    expect(heldText("index.md")?.content).toBe("# T1");
    expect(heldRows()).toHaveLength(2);
  });

  it("keeps a flush refused after the reopen beside text the hide held there", async () => {
    // The hide's text was typed on the vault's, not on the flush's, so it is
    // no newer version of that text.
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");
    const refuseFlush = refusedLater();

    note.change("# T1");
    note.open("other.md");
    note.open("index.md");
    // Declined as a read from before the flush (#304); the buffer keeps it.
    expect(note.allowReload("the index note")).toBe(false);
    note.change("# T2");
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    await pagehide();
    await refuseFlush();

    expect(heldRows()).toHaveLength(2);
  });

  it("keeps held text a pane never showed beside that pane's failed save", async () => {
    const note = renderAutosave("daily/2026-08-05.md", () => "the index note");
    note.seed("index.md", "the index note");
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });

    note.open("index.md");
    note.change("the index note!");
    saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await idle();

    expect(heldText("index.md")?.content).toBe("# held");
    expect(heldRows()).toHaveLength(2);
  });

  it("keeps held text a pane never showed beside that pane's refused save", async () => {
    const note = renderAutosave("daily/2026-08-05.md", () => "the index note");
    note.seed("index.md", "the index note");
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });

    note.open("index.md");
    note.change("the index note!");
    saveNote.mockRejectedValueOnce(new ChangedOnDisk());
    await idle();

    expect(heldText("index.md")?.content).toBe("# held");
    expect(heldRows()).toHaveLength(2);
  });

  it("keeps every text when a write fails after its note moved onto a path holding text", async () => {
    // Text left from a note deleted at the new path, and text of the note moved.
    holdText("moved.md", { content: "# stale", reason: "failed with 500", conflicted: false });
    holdText("index.md", { content: "# hidden", reason: "hidden", conflicted: false });
    const note = renderAutosave("index.md");
    const write = pendingSave();

    note.change("# edited");
    await idle();
    moveHeld((path) => (path === "index.md" ? "moved.md" : undefined));
    note.open("moved.md");
    await write.break();

    expect(heldText("index.md")).toBeUndefined();
    expect(heldText("moved.md")?.content).toBe("# stale");
    expect(heldRows().map(({ path }) => path)).toEqual(["moved.md", "moved.md", "moved.md"]);
  });

  describe("held text of another note at the path", () => {
    // Left by a note deleted at Y.md; the note there now was moved onto it.
    const theirs = "---\nid: y\n---\nthe deleted note's text";
    const mine = "---\nid: x\n---\nthe moved note's text";
    const vault = "---\nid: x\n---\nthe moved note";

    it("offers no held text of a deleted note to a note moved onto its path", async () => {
      holdText("Y.md", { content: theirs, reason: "failed with 500", conflicted: false });
      const note = renderAutosave("Y.md");

      expect(note.allowReload(vault)).toBe(true);

      expect(note.status()).toBe("saved");
      expect(note.restored()).toBe(false);
      expect(heldText("Y.md")?.content).toBe(theirs);
      expect(await note.saved()).toBe(true);
      expect(saveNote).not.toHaveBeenCalled();
    });

    it("offers a note its own entry behind a foreign one at its path", async () => {
      holdText("Y.md", { content: theirs, reason: "failed with 500", conflicted: false });
      holdText("Y.md", { content: mine, reason: "failed with 502", conflicted: false });
      const note = renderAutosave("other.md");
      note.seed("Y.md", vault);
      note.open("Y.md");

      expect(note.allowReload(vault)).toBe(false);

      expect(note.status()).toBe("error");
      expect(await note.saved()).toBe(true);
      expect(saveNote).toHaveBeenLastCalledWith("Y.md", mine, false, noteBase(vault));
      expect(heldText("Y.md")?.content).toBe(theirs);
    });

    it("loads the vault's text over a foreign entry the editor opened on", async () => {
      // The vault's text was not cached, so the editor opened on the oldest.
      holdText("Y.md", { content: theirs, reason: "failed with 500", conflicted: false });
      holdText("Y.md", { content: mine, reason: "failed with 502", conflicted: false });
      const note = renderAutosave("Y.md", () => theirs);

      expect(note.allowReload(vault)).toBe(true);

      expect(note.status()).toBe("saved");
      expect(note.restored()).toBe(false);
      expect(heldRows()).toHaveLength(2);
    });

    it("offers an entry with no id as before", () => {
      holdText("Y.md", { content: "# held", reason: "failed with 500", conflicted: false });
      const note = renderAutosave("Y.md");

      expect(note.allowReload(vault)).toBe(false);

      expect(note.restored()).toBe(true);
      expect(note.status()).toBe("error");
    });

    it("offers a note its own entry when the reader edited its id line", () => {
      holdText("Y.md", {
        content: "---\nid: edited\n---\n# held",
        reason: "failed with 500",
        conflicted: false,
        base: "---\nid: x\n---\n# start",
      });
      const note = renderAutosave("Y.md");

      expect(note.allowReload("---\nid: x\nmodified: now\n---\n# start")).toBe(false);

      expect(note.restored()).toBe(true);
    });
  });
});
