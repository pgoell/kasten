import { heldText, heldTexts } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  background,
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

  describe("save queue (#301-#307)", () => {
    afterEach(() => {
      fetchNote.mockReset();
    });

    /**
     * The hook with an editor on `index.md`, as in the block above, plus a way
     * to put text on screen by hand: a reopen or a second pane shows what its
     * own buffer holds, not what the cache moved to.
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
        outside: (text: string) => {
          note.seed("index.md", text);
          seen = text;
          if (note.allowReload(text)) doc = text;
        },
        /** What the focused editor shows, set by hand. */
        show: (text: string) => {
          doc = text;
          seen = text;
        },
        /** `:e!`: the route reads the vault into the cache, then asks. */
        discard: (text: string) => {
          note.seed("index.md", text);
          note.revert(true);
          doc = text;
          seen = text;
        },
        shown: () => doc,
      };
    }

    it("never sends a write still queued at :e!", async () => {
      const { note, type, discard, shown } = withEditor("start");
      const first = pendingSave();

      type("T1");
      await idle();
      type("T2");
      note.startSave();
      discard("start");
      await first.finish();
      await settled();

      // T2 never goes; "start" is the write `:e!` queues behind T1 (#311).
      expect(saveNote.mock.calls.map((call) => call[1])).toEqual(["T1", "start"]);
      expect(note.cached("index.md")).not.toBe(written("T2").content);
      expect(shown()).toBe("start");
    });

    it("lets a rename wait for the write in the air, and refuses when it fails", async () => {
      const { note, type } = withEditor("start");
      const first = pendingSave();

      type("T1");
      await idle();
      let outcome: boolean | undefined;
      void note.askSaveFirst().then((answer) => {
        outcome = answer;
      });
      await settled();

      // Nothing is pending, but the note's write is still on its way: a rename
      // now would move the path under it.
      expect(outcome).toBeUndefined();
      await first.break();
      await settled();
      expect(outcome).toBe(false);
    });

    it("sends nothing on hide when the note reloaded since its write went out", async () => {
      const { type, outside } = withEditor("start");
      pendingSave();

      type("T1");
      await idle();
      outside("R");
      await pagehide();

      // T1 was typed on "start", and the screen holds R now: a keepalive of it
      // named R would land it over another writer's text unasked.
      expect(saveNote.mock.calls.filter((call) => call[2] === true)).toEqual([]);
    });

    it("declines a refetch answering while a write is in the air, and reloads once it lands", async () => {
      const { note, type } = withEditor("start");
      const first = pendingSave();
      const invalidate = vi.spyOn(note.client, "invalidateQueries");

      type("T1");
      await idle();
      // A refetch that started before T1 went out, answering with the text
      // under it. `pending` is empty, but the screen holds newer text.
      expect(note.allowReload("start")).toBe(false);
      await first.finish();
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["note", "index.md"] }),
        expect.anything(),
      );
    });

    it("holds and resends the flush to a note just left when the page is hidden", async () => {
      const { note, type } = withEditor("start");
      pendingSave();

      type("A text");
      note.seed("b.md", "b text");
      note.open("b.md");
      await pagehide();

      // The hook follows b.md now, and the flush to index.md is the only copy
      // of A's text, which the page going away cancels.
      expect(heldText("index.md")).toMatchObject({ content: "A text" });
      expect(saveNote).toHaveBeenCalledWith("index.md", "A text", true, expect.anything());
    });

    it("reopens a note on the flush's text and names its answer behind it", async () => {
      const { note, type, look, show } = withEditor("start");
      const flush = pendingSave();

      type("T1");
      note.seed("other.md", "other");
      note.open("other.md");
      // The flush's text goes into the cache as it goes out, so the editor
      // opened next reads the reader's newest text and not the text under it.
      expect(note.cached("index.md")).toBe("T1");
      note.open("index.md");
      show(String(note.cached("index.md")));
      note.allowReload(String(note.cached("index.md")));
      type("T1, T2");
      await idle();
      await flush.finish();
      await settled();
      look();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "T1, T2",
        false,
        noteBase(written("T1").content),
      );
      expect(note.status()).not.toBe("conflict");
    });

    it("lets a second pane type on the first pane's text while its write is in the air", async () => {
      const { note, type, look, show, shown } = withEditor("start");
      const flush = pendingSave();

      type("A1");
      // Pane b's own buffer, opened before A1 was typed, holds its text before
      // the focus moves. It takes the cache the way a standby pane does.
      show("start");
      note.focus("b");
      look();
      type(`${shown()}, B`);
      await idle();
      await flush.finish();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "A1, B",
        false,
        noteBase(written("A1").content),
      );
      expect(note.status()).not.toBe("conflict");
    });

    it("follows the queue in a second pane that took the first pane's text before it got the focus", async () => {
      const { note, type, shown } = withEditor("start");
      const flush = pendingSave();

      type("A1");
      // Pane b took A1 through the route's standby reload while unfocused, so
      // it shows A1 at the opening and asks the hook nothing.
      note.focus("b");
      type(`${shown()}, B`);
      await idle();
      await flush.finish();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "A1, B",
        false,
        noteBase(written("A1").content),
      );
      expect(note.status()).not.toBe("conflict");
    });

    it("names the old text from a pane that never took the first pane's, and holds the refusal", async () => {
      const { note, type, show } = withEditor("start");
      const flush = pendingSave();
      const refuse = refusedLater();

      type("A1");
      // Pane b still shows the text from before A1 and took nothing since:
      // typed on that, its write must name it, and the vault refuse it. The
      // view holds that text before the focus moves.
      show("start");
      note.focus("b");
      type("start, B");
      await idle();
      await flush.finish();
      await settled();
      await refuse();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "start, B", false, noteBase("start"));
      expect(note.status()).toBe("conflict");
      expect(heldText("index.md")).toMatchObject({ content: "start, B", conflicted: true });
      expect(saveNote).not.toHaveBeenCalledWith("index.md", "start, B");
    });

    it("names the keepalive's answer on the next write when the page lives on", async () => {
      const { type } = withEditor("start");
      const first = pendingSave();
      const keepalive = pendingSave();

      type("T1");
      await idle();
      type("T2");
      await background();
      type("T2, T3");
      await idle();
      await first.finish();
      await keepalive.finish();
      await settled();

      // The keepalive left after W1 and lands after it: T2 is on disk when T3
      // goes out.
      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "T2, T3",
        false,
        noteBase(written("T2").content),
      );
    });

    it("resends a refused keepalive naming the base when the write ahead of it failed", async () => {
      const { note, type } = withEditor("start");
      const first = pendingSave();
      const refuse = refusedLater();

      type("A");
      await idle();
      type("B");
      await pagehide();
      await first.break();
      // The keepalive named A, which never landed: its refusal is no conflict.
      await refuse();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "B",
        expect.any(Boolean),
        noteBase("start"),
      );
      expect(note.status()).not.toBe("conflict");
    });

    it("reads the note before naming a base after a write failed with no answer", async () => {
      const { type } = withEditor("start");
      // The server wrote T2 and the response was lost on the way back. With a
      // real stamp, which the hook checks the read against.
      const stamped = "---\nmodified: now\n---\nT2";
      fetchNote.mockResolvedValue(stamped);

      type("T1");
      await idle();
      type("T2");
      saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await idle();
      await settled();
      type("T2, T3");
      await idle();
      await settled();

      expect(fetchNote).toHaveBeenCalledWith("index.md");
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "T2, T3", false, noteBase(stamped));
    });

    it("keeps the old base after a write lost on the network when somebody else wrote meanwhile", async () => {
      const { type } = withEditor("start");
      // Somebody else wrote X, and W1 never reached the server.
      fetchNote.mockResolvedValue("X");

      type("T1");
      saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await idle();
      await settled();
      type("T1, T2");
      await idle();
      await settled();

      // X is not our text: naming it would land T2 over X unasked.
      expect(fetchNote).toHaveBeenCalledWith("index.md");
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "T1, T2", false, noteBase("start"));
    });

    it("keeps a failed flush's text on the screen it reopened on", async () => {
      const { note, type, look, show, shown } = withEditor("start");
      const flush = pendingSave();

      type("T1");
      note.seed("other.md", "other");
      note.open("other.md");
      note.open("index.md");
      show(String(note.cached("index.md")));
      note.allowReload("T1");
      await flush.break();
      await settled();
      look();

      // The clean screen showed T1 and nothing else holds it: it stays there,
      // unwritten, and not only on the bar.
      expect(shown()).toBe("T1");
      expect(note.status()).toBe("error");
      expect(note.restored()).toBe(true);
    });

    it("drops an older write to a left note refused behind the hide's keepalive", async () => {
      const { note, type } = withEditor("start");
      const refuse = refusedLater();
      const keepalive = pendingSave();

      type("T1");
      await idle();
      type("T2");
      note.seed("b.md", "b");
      note.open("b.md");
      // The page lives on: the keepalive of T2 lands before W1, which the
      // vault then refuses. T1 is older text T2 was typed on, not a conflict.
      await background();
      await keepalive.finish();
      await refuse();
      await settled();

      expect(heldTexts("index.md").map((entry) => entry.content)).not.toContain("T1");
    });

    it("lets a rename go when a later write landed after a failed one", async () => {
      const { note, type } = withEditor("start");
      const first = pendingSave();

      type("T1");
      await idle();
      type("T1, T2");
      note.startSave();
      let outcome: boolean | undefined;
      void note.askSaveFirst().then((answer) => {
        outcome = answer;
      });
      await first.break();
      await settled();

      // The second write carried T1 and landed: the vault holds the buffer.
      expect(outcome).toBe(true);
    });

    it("drops a failed flush's text that a later write in another visit carries", async () => {
      const { note, type, shown } = withEditor("start");
      const first = pendingSave();

      type("T1");
      await idle();
      // Pane b shows T1 at the opening, and types on it behind W1.
      note.focus("b");
      type(`${shown()}, T2`);
      await idle();
      await first.break();
      await settled();

      // T2 landed with T1 in it: held, T1 would be offered as a conflict with
      // it, and `:w` there would lose T2.
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "T1, T2", false, expect.anything());
      expect(heldTexts("index.md").map((entry) => entry.content)).not.toContain("T1");
    });
  });
});
