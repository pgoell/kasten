import { act } from "@testing-library/react";
import { ChangedOnDisk } from "@/lib/api";
import { heldText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  eachPage,
  idle,
  pagehide,
  pendingSave,
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

  describe("the base a save names", () => {
    it("names the vault's text under the buffer", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# edited");
      await idle();
      await settled();

      expect(saveNote).toHaveBeenCalledWith(
        "index.md",
        "# edited",
        false,
        noteBase("the index note"),
      );
    });

    it("names its own landed text when the typing goes on through a save", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# edited");
      await idle();
      await settled();
      note.change("# edited more");
      await idle();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited more",
        false,
        noteBase(written("# edited").content),
      );
    });

    it("names another writer's text once a reload took it into a clean buffer", async () => {
      const note = renderAutosave();

      note.change("# edited");
      await idle();
      await settled();
      expect(note.reconcile()).toBe(true);
      expect(note.allowReload("somebody else's text")).toBe(true);
      note.change("somebody else's text, and mine");
      await idle();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "somebody else's text, and mine",
        false,
        noteBase("somebody else's text"),
      );
    });

    it("names the vault's text read for :e! once the typing starts again", async () => {
      // The route reads the vault into the cache, then throws the buffer away.
      const note = renderAutosave();

      note.change("# edited");
      await idle();
      await settled();
      note.change("# edited more");
      note.seed("index.md", "somebody else's text");
      note.revert(true);
      note.change("somebody else's text, and mine");
      await idle();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "somebody else's text, and mine",
        false,
        noteBase("somebody else's text"),
      );
    });

    it("sends :w during a quiet write once that write lands, naming what it landed as", async () => {
      // What the quiet write lands as is what `:w` finds on disk, and only its
      // answer says what that is.
      const note = renderAutosave();
      note.seed("index.md", "the index note");
      const quiet = pendingSave();

      note.change("# edited");
      await idle();
      await settled();
      note.change("# edited more");
      note.startSave();
      await settled();
      expect(saveNote).toHaveBeenCalledOnce();
      await quiet.finish();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited more",
        false,
        noteBase(written("# edited").content),
      );
      expect(note.status()).toBe("saved");
    });

    it("names the landed text when the vault stamped more than modified on the write before", async () => {
      // A note with no block gets one on its first save, so the text sent never
      // hashes like the text that landed.
      const note = renderAutosave();
      note.seed("index.md", "the index note");
      const stamped = (content: string) => `---\nid: 1\nmodified: now\n---\n${content}`;
      let land: (() => void) | undefined;
      saveNote.mockImplementationOnce(
        (path: string, content: string) =>
          new Promise((resolve) => {
            land = () => resolve({ path, content: stamped(content) });
          }),
      );

      note.change("# edited");
      await idle();
      await settled();
      note.change("# edited more");
      note.startSave();
      await settled();
      await act(async () => land?.());
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited more",
        false,
        noteBase(stamped("# edited")),
      );
    });

    it("names its own visit's base behind a flush still in the air from the visit before", async () => {
      // Back before the flush answered, so the buffer opened on the cache's
      // text and not the flushed one: naming what the flush lands as would put
      // this buffer over text that is then nowhere else.
      const note = renderAutosave("index.md");
      note.seed("index.md", "the index note");
      const flush = pendingSave();

      note.change("# T1");
      note.open("other.md");
      await settled();
      note.open("index.md");
      // A buffer still on the old text; the read of it is from before the
      // flush, and declined (#304).
      expect(note.allowReload("the index note")).toBe(false);
      note.change("# T2");
      saveNote.mockRejectedValueOnce(new ChangedOnDisk());
      note.startSave();
      await flush.finish();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# T2",
        false,
        noteBase("the index note"),
      );
      expect(note.status()).toBe("conflict");
      await note.save();
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "# T2");
    });

    it("names the base of a write before it that failed, which never landed", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");
      const quiet = pendingSave();

      note.change("# edited");
      await idle();
      await settled();
      note.change("# edited more");
      note.startSave();
      await settled();
      await quiet.break();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited more",
        false,
        noteBase("the index note"),
      );
    });

    it("reads a save the vault refused over its base as a conflict, and keeps the text", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");
      saveNote.mockRejectedValueOnce(new ChangedOnDisk());

      note.change("# edited");
      await idle();
      await settled();

      expect(note.status()).toBe("conflict");
      expect(note.restored()).toBe(true);
      expect(heldText("index.md")).toMatchObject({ content: "# edited", conflicted: true });
      expect(note.cached("index.md")).toBe("the index note");
      expect(await note.saveFirst()).toBe(false);
      // Nothing more goes out on its own, and `:w` sends the kept text over
      // whatever is there, naming no base.
      await idle();
      await settled();
      expect(saveNote).toHaveBeenCalledOnce();
      await note.save();
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "# edited");
    });

    it("only holds a refused write when a reload took the vault's text into the buffer meanwhile", async () => {
      // The other writer's event found nothing waiting, so the editor took their
      // text: the refused text is on screen nowhere, and `:w` must not send it.
      let doc = "# edited";
      const note = renderAutosave("index.md", () => doc);
      note.seed("index.md", "the index note");
      let refuse: (() => void) | undefined;
      saveNote.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            refuse = () => reject(new ChangedOnDisk());
          }),
      );

      note.change("# edited");
      await idle();
      await settled();
      // The event is declined while the write is in the air (#296); a route
      // write still reaches the editor through the cache.
      expect(note.reconcile()).toBe(false);
      expect(note.allowReload("somebody else's text")).toBe(true);
      doc = "somebody else's text";
      await act(async () => refuse?.());

      expect(heldText("index.md")).toMatchObject({ content: "# edited", conflicted: true });
      expect(note.restored()).toBe(false);
      expect(note.status()).toBe("saved");
      await note.save();
      expect(saveNote).toHaveBeenCalledOnce();
    });

    it("holds a flush on leaving that the vault refused as conflicted, and reopens it as one", async () => {
      const note = renderAutosave("index.md");
      note.seed("index.md", "the index note");
      saveNote.mockRejectedValueOnce(new ChangedOnDisk());

      note.change("# edited");
      note.open("other.md");
      await settled();

      expect(heldText("index.md")).toMatchObject({ content: "# edited", conflicted: true });
      note.open("index.md");
      expect(note.allowReload("somebody else's text")).toBe(false);
      expect(note.status()).toBe("conflict");
    });

    it("marks nothing on an outside write's event, and shows the conflict once the save is refused", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# edited");
      expect(note.reconcile()).toBe(false);
      expect(note.status()).toBe("unsaved");

      saveNote.mockRejectedValueOnce(new ChangedOnDisk());
      await idle();

      expect(saveNote).toHaveBeenCalledWith(
        "index.md",
        "# edited",
        false,
        noteBase("the index note"),
      );
      expect(note.status()).toBe("conflict");
    });

    it("names the old base over a route write under a dirty buffer, so the vault refuses it", async () => {
      // A bookmark landing in the open note reaches the editor through the
      // cache. The buffer keeps its text, and the save that follows is what
      // finds out, rather than writing over the bookmark.
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# edited");
      expect(note.allowReload("the index note\nreading: epubcfi(/6/4)")).toBe(false);
      expect(note.status()).toBe("unsaved");

      saveNote.mockRejectedValueOnce(new ChangedOnDisk());
      await idle();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited",
        false,
        noteBase("the index note"),
      );
      expect(note.status()).toBe("conflict");
    });

    it("names the vault's text under the buffer as the keepalive's base", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# typed just now");
      await pagehide();

      expect(saveNote).toHaveBeenCalledWith(
        "index.md",
        "# typed just now",
        true,
        noteBase("the index note"),
      );
    });
  });
});
