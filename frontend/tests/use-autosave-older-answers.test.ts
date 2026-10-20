import { heldText, heldTexts } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  eachPage,
  idle,
  pagehide,
  pendingSave,
  refusedLater,
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

  describe("an older write answering behind a newer one (#296, #297, #298)", () => {
    /**
     * The hook with an editor on `index.md`, opened on `seed`. The editor puts
     * the cache on screen when it moves, asking first, as its reload does; it
     * asks nothing while the cache stands still.
     */
    function withEditor(seed: string) {
      let doc = seed;
      const note = renderAutosave("index.md", () => doc);
      note.seed("index.md", seed);
      let seen: unknown = seed;
      return {
        note,
        type: (text: string) => {
          doc = text;
          note.change(text);
        },
        look: () => {
          const now = note.cached("index.md");
          if (now === seen || typeof now !== "string") return;
          seen = now;
          if (note.allowReload(now)) doc = now;
        },
        /** Another writer's text, reaching the editor through the cache. */
        outside: (text: string) => {
          note.seed("index.md", text);
          seen = text;
          if (note.allowReload(text)) doc = text;
        },
        shown: () => doc,
      };
    }

    it("keeps the first write's answer out of the cache while the second is queued", async () => {
      const { note, type, look, shown } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first.finish();
      look();

      expect(note.cached("index.md")).toBe("start");
      expect(shown()).toBe("T2");
      expect(note.status()).toBe("saving");
      await second.finish();
      expect(note.cached("index.md")).toBe(written("T2").content);
      expect(note.status()).toBe("saved");
    });

    it("keeps keys typed after the first write lands on the second write's text", async () => {
      const { type, look, shown } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first.finish();
      look();
      type(`${shown()}, and more`);
      await second.finish();
      look();
      await idle();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "T2, and more",
        false,
        noteBase(written("T2").content),
      );
    });

    it("keeps the second write's text in pending when it fails after the first landed", async () => {
      const { note, type, look, shown } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first.finish();
      look();
      await second.break();
      look();

      expect(note.status()).toBe("error");
      expect(note.restored()).toBe(true);
      // The vault's text, which the first write left there; the screen keeps
      // the second's.
      expect(note.cached("index.md")).toBe(written("T1").content);
      expect(shown()).toBe("T2");
      await note.save();
      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "T2",
        false,
        noteBase(written("T1").content),
      );
    });

    it("keeps the second write's text in pending when it is refused after the first landed", async () => {
      const { note, type, look } = withEditor("start");
      const first = pendingSave();
      const refuse = refusedLater();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first.finish();
      look();
      await refuse();
      look();

      expect(note.status()).toBe("conflict");
      expect(note.cached("index.md")).toBe("start");
      expect(heldText("index.md")).toMatchObject({ content: "T2", conflicted: true });
      await note.save();
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "T2");
    });

    it("holds the second write as a conflict when both are refused", async () => {
      const { note, type } = withEditor("start");
      const first = refusedLater();
      const second = refusedLater();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first();
      await settled();
      await second();

      expect(note.status()).toBe("conflict");
      expect(heldText("index.md")).toMatchObject({ content: "T2", conflicted: true });
    });

    it("declines an outside write's event while a write is in the air", async () => {
      const { note, type } = withEditor("start");
      pendingSave();
      pendingSave();

      type("T1");
      await idle();
      expect(note.reconcile()).toBe(false);
      type("T2");
      await idle();
      expect(note.reconcile()).toBe(false);
    });

    it("reloads a declined event's note once the last write to it answers", async () => {
      const { note, type } = withEditor("start");
      const first = pendingSave();
      const invalidate = vi.spyOn(note.client, "invalidateQueries");

      type("T1");
      await idle();
      expect(note.reconcile()).toBe(false);
      expect(invalidate).not.toHaveBeenCalled();
      await first.finish();

      expect(invalidate).toHaveBeenCalledWith(
        { queryKey: ["note", "index.md"] },
        { cancelRefetch: false },
      );
    });

    it("names a reload's text behind a write that fails", async () => {
      const { note, type, outside } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      outside("E");
      type("E, and mine");
      await idle();
      await first.break();
      await second.finish();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "E, and mine", false, noteBase("E"));
      expect(note.status()).toBe("saved");
    });

    it("names a reload's text behind a write that lands, and caches neither answer over it", async () => {
      const { note, type, outside } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      outside("E");
      type("E, and mine");
      await idle();
      await first.finish();

      expect(note.cached("index.md")).toBe("E");
      await second.finish();
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "E, and mine", false, noteBase("E"));
    });

    it("reopens without a conflict after the second write and the flush fail behind a landed first", async () => {
      const { note, type, look } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first.finish();
      look();
      await second.break();
      look();
      saveNote.mockRejectedValueOnce(new Error("PUT /api/files/index.md failed with 500"));
      note.open("other.md");
      await settled();
      note.open("index.md");
      // The editor opens on what the cache holds, and asks about it.
      note.allowReload(String(note.cached("index.md")));

      expect(note.status()).toBe("error");
    });

    it("drops an older write that fails behind the hide's text when another note reloaded", async () => {
      let doc = "start";
      const note = renderAutosave("index.md", () => doc);
      note.seed("index.md", "start");
      const first = pendingSave();
      pendingSave();

      doc = "T1";
      note.change("T1");
      await idle();
      doc = "T1x";
      note.change("T1x");
      await pagehide();
      note.seed("b.md", "b text");
      doc = "b text";
      note.open("b.md");
      note.allowReload("somebody else's b");
      await first.break();

      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1x"]);
    });

    it("keeps the base in the cache when a keepalive behind a failed write fails too", async () => {
      let doc = "start";
      const note = renderAutosave("index.md", () => doc);
      note.seed("index.md", "start");
      const first = pendingSave();
      const keepalive = pendingSave();

      doc = "T1";
      note.change("T1");
      await idle();
      doc = "T1x";
      note.change("T1x");
      await pagehide();
      await first.break();
      await keepalive.break();

      expect(note.cached("index.md")).toBe("start");
    });

    it("names a reload's text typed while the older write was in the air, once that write lands", async () => {
      const { type, outside } = withEditor("start");
      const first = pendingSave();

      type("T1");
      await idle();
      outside("E");
      type("E, and mine");
      await first.finish();
      await idle();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "E, and mine", false, noteBase("E"));
    });

    it("holds an older write that fails after a reload beside the hide's text", async () => {
      const { type, outside } = withEditor("start");
      const first = pendingSave();
      pendingSave();

      type("T1");
      await idle();
      outside("E");
      type("E, and mine");
      await pagehide();
      await first.break();

      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["E, and mine", "T1"]);
    });

    it("names a reload's text on the keepalive, not the write in the air", async () => {
      const { type, outside } = withEditor("start");
      pendingSave();
      pendingSave();

      type("T1");
      await idle();
      outside("E");
      type("E, and mine");
      await pagehide();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "E, and mine", true, noteBase("E"));
      expect(heldText("index.md")).toMatchObject({ content: "E, and mine", base: "E" });
      expect(heldText("index.md")?.after).toBeUndefined();
    });

    it("keeps a flush's answer out of the cache while the next pane's write is queued", async () => {
      const { note, type } = withEditor("start");
      const flush = pendingSave();
      const second = pendingSave();

      type("from pane a");
      note.focus("b");
      type("from pane b");
      await idle();
      await flush.finish();

      // The text the leave sent, put there as it went (#303), not its answer.
      expect(note.cached("index.md")).toBe("from pane a");
      await second.finish();
      expect(note.cached("index.md")).toBe(written("from pane b").content);
    });
  });
});
