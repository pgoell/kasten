import { act } from "@testing-library/react";
import { noteBase } from "@/lib/notes/note-base";
import { heldText } from "@/lib/saving/held-text";
import {
  eachPage,
  heldRows,
  idle,
  pendingSave,
  refused,
  renderAutosave,
  settled,
} from "./autosave-fixture";

const { saveNote, fetchNote } = vi.hoisted(() => ({ saveNote: vi.fn(), fetchNote: vi.fn() }));
// The real refusal, which the hook tells apart from every other failure.
vi.mock("@/lib/core/api", async (importOriginal) => ({
  saveNote,
  fetchNote,
  ChangedOnDisk: (await importOriginal<typeof import("@/lib/core/api")>()).ChangedOnDisk,
}));

describe("useAutosave", () => {
  eachPage();

  describe("a failed write under newer text (#290)", () => {
    it("never writes a failed write's text over newer text that landed behind it", async () => {
      let screen = "start";
      const note = renderAutosave("index.md", () => screen);
      note.seed("index.md", "start");
      const first = pendingSave();
      screen = "A";
      note.change("A");
      await idle();
      const second = pendingSave();
      screen = "B";
      note.change("B");
      await idle();

      await first.break();
      await second.finish();

      expect(note.status()).toBe("saved");
      saveNote.mockClear();
      await note.save();
      note.open("other.md");
      expect(saveNote).not.toHaveBeenCalled();
      expect(heldText("index.md")).toBeUndefined();
    });

    it("keeps the newer text waiting when the write behind a failed one fails too", async () => {
      let screen = "start";
      const note = renderAutosave("index.md", () => screen);
      note.seed("index.md", "start");
      const first = pendingSave();
      screen = "A";
      note.change("A");
      await idle();
      const second = pendingSave();
      screen = "B";
      note.change("B");
      await idle();

      await first.break();
      await second.break();

      expect(heldRows().map((row) => row.entry.content)).toEqual(["B"]);
      saveNote.mockClear();
      await note.save();
      expect(saveNote.mock.calls.map((call) => call[1])).toEqual(["B"]);
    });

    it("holds a failed write's text when the buffer took other text while it was in the air", async () => {
      let screen = "start";
      const note = renderAutosave("index.md", () => screen);
      note.seed("index.md", "start");
      const first = pendingSave();
      screen = "A";
      note.change("A");
      await idle();
      // Somebody else writes the note, and the clean buffer takes their text.
      expect(note.allowReload("X")).toBe(true);
      screen = "X";

      await first.break();

      expect(heldText("index.md")?.content).toBe("A");
      expect(note.status()).toBe("saved");
      screen = "X typed";
      note.change("X typed");
      await idle();
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "X typed", false, noteBase("X"));
      expect(heldText("index.md")?.content).toBe("A");
    });

    it("holds a failed write's text when the reader typed on other text the buffer took", async () => {
      let screen = "start";
      const note = renderAutosave("index.md", () => screen);
      note.seed("index.md", "start");
      const first = pendingSave();
      screen = "A";
      note.change("A");
      await idle();
      expect(note.allowReload("X")).toBe(true);
      screen = "X typed";
      note.change("X typed");

      await first.break();
      await idle();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "X typed", false, noteBase("X"));
      expect(heldText("index.md")?.content).toBe("A");
    });

    it("holds a failed write's text when a write typed on other text the buffer took is queued behind it", async () => {
      let screen = "start";
      const note = renderAutosave("index.md", () => screen);
      note.seed("index.md", "start");
      const first = pendingSave();
      screen = "A";
      note.change("A");
      await idle();
      expect(note.allowReload("X")).toBe(true);
      const second = pendingSave();
      screen = "X typed";
      note.change("X typed");
      await idle();

      await first.break();

      expect(heldText("index.md")?.content).toBe("A");
      await second.finish();
    });
  });

  describe(":e during a write (#291)", () => {
    it("refuses :e without the bang while a write is in the air, and holds that write's text when it fails", async () => {
      const note = renderAutosave("index.md", () => "A");
      note.seed("index.md", "start");
      const write = pendingSave();
      note.change("A");
      await idle();

      expect(note.revert(false)).toBe(false);
      await write.break();

      expect(heldText("index.md")?.content).toBe("A");
    });

    it("lets :e through once the write has answered", async () => {
      const note = renderAutosave("index.md", () => "A");
      note.seed("index.md", "start");
      const write = pendingSave();
      note.change("A");
      await idle();
      await write.finish();

      expect(note.revert(false)).toBe(true);
    });

    it("still throws the buffer away on :e! while a write is in the air", async () => {
      const note = renderAutosave("index.md", () => "A");
      note.seed("index.md", "start");
      const write = pendingSave();
      note.change("A");
      await idle();

      expect(note.revert(true)).toBe(true);
      await write.break();

      expect(heldText("index.md")).toBeUndefined();
      expect(note.status()).toBe("saved");
    });
  });

  describe("a write that failed for want of a signal", () => {
    async function offline(note: ReturnType<typeof renderAutosave>) {
      note.seed("index.md", "start");
      saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      note.change("A");
      await idle();
      expect(note.status()).toBe("error");
      saveNote.mockClear();
    }

    it("goes again when the signal returns", async () => {
      const note = renderAutosave("index.md", () => "A");
      await offline(note);

      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      await settled();

      expect(saveNote).toHaveBeenCalledWith("index.md", "A", false, noteBase("start"));
      expect(note.status()).toBe("saved");
    });

    it("goes again every half minute", async () => {
      const note = renderAutosave("index.md", () => "A");
      await offline(note);

      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await settled();

      expect(saveNote).toHaveBeenCalledOnce();
      expect(note.status()).toBe("saved");
    });

    it("leaves a write the vault turned away, which another try gets again", async () => {
      const note = renderAutosave("index.md", () => "A");
      note.seed("index.md", "start");
      saveNote.mockRejectedValueOnce(new Error("failed with 422", { cause: 422 }));
      note.change("A");
      await idle();
      saveNote.mockClear();

      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });

      expect(saveNote).not.toHaveBeenCalled();
      expect(note.status()).toBe("error");
    });

    it("leaves a conflict to :w", async () => {
      const note = renderAutosave("index.md", () => "A");
      note.seed("index.md", "start");
      note.change("A");
      await refused();
      saveNote.mockClear();

      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });

      expect(saveNote).not.toHaveBeenCalled();
      expect(note.status()).toBe("conflict");
    });
  });
});
