import { heldText, heldTexts, landedAs } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  background,
  eachPage,
  idle,
  pagehide,
  reopen,
  server,
  settled,
  withEditor,
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

  describe("a keepalive behind a queued write, and :e! during a write (#310, #311)", () => {
    it("names the last write sent on hide behind a queued write, and lands over it", async () => {
      const vault = server("start");
      const { note, type } = withEditor("start");

      type("T1");
      await idle();
      type("T2");
      note.startSave();
      await pagehide();
      // W2 waits behind W1 and never left: on disk after W1 is T1, not the base.
      expect(vault.request(1)).toMatchObject({
        content: "T2",
        keepalive: true,
        base: noteBase("T1"),
      });
      // The page is gone: W1 and the keepalive reach the vault, unheard.
      await vault.arrive(0);
      await vault.arrive(1);
      expect(landedAs("T2", vault.disk())).toBe(true);

      const again = reopen(vault.disk(), "T2");
      expect(heldText("index.md")).toBeUndefined();
      expect(again.status()).toBe("saved");
    });

    it("names the last write sent for a left note whose newest write is still queued", async () => {
      const vault = server("start");
      const { note, type } = withEditor("start");

      type("T1");
      await idle();
      type("T2");
      note.startSave();
      note.seed("b.md", "b");
      note.open("b.md");
      await pagehide();
      expect(vault.request(1)).toMatchObject({
        content: "T2",
        keepalive: true,
        base: noteBase("T1"),
      });
      await vault.arrive(0);
      await vault.arrive(1);
      expect(landedAs("T2", vault.disk())).toBe(true);

      const again = reopen(vault.disk(), "T2");
      expect(heldText("index.md")).toBeUndefined();
      expect(again.status()).toBe("saved");
    });

    it("resends a keepalive that overtook the write ahead of it, naming that write's answer", async () => {
      const vault = server("start");
      const { note, type } = withEditor("start");

      type("T1");
      await idle();
      type("T2");
      await pagehide();
      // The keepalive reaches the vault first, which still holds "start".
      await vault.land(1);
      await vault.land(0);
      const first = vault.disk();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "T2", false, noteBase(first));
      await vault.land(2);
      expect(landedAs("T2", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).not.toBe("conflict");
    });

    it("holds a keepalive refused after the write ahead landed as a conflict", async () => {
      const vault = server("start");
      const { note, type } = withEditor("start");

      type("T1");
      await idle();
      type("T2");
      await pagehide();
      await vault.land(0);
      // Somebody else writes between W1 and the keepalive: a true conflict.
      vault.write("X");
      await vault.land(1);

      expect(saveNote).toHaveBeenCalledTimes(2);
      expect(vault.disk()).toBe("X");
      expect(heldText("index.md")).toMatchObject({ content: "T2", conflicted: true });
      expect(note.status()).toBe("conflict");
    });

    it("keeps what :e! threw away out of the vault and off the screen when its write lands after", async () => {
      const vault = server("start");
      const { note, type, look, outside, discard, shown } = withEditor("start");

      type("T1");
      await idle();
      discard("start");
      await vault.land(0);
      // W1's event, and a refetch answering with what W1 landed.
      const echo = vault.disk();
      if (note.reconcile()) outside(echo);
      outside(echo);
      expect(shown()).toBe("start");
      expect(note.status()).toBe("saving");

      await vault.land(1);
      look();
      expect(saveNote.mock.calls.map((call) => call[1])).toEqual(["T1", "start"]);
      expect(landedAs("start", vault.disk())).toBe(true);
      expect(landedAs("start", shown())).toBe(true);
      expect(note.status()).toBe("saved");
    });

    it("reloads somebody else's text when the write after :e! is refused, holding nothing", async () => {
      const vault = server("start");
      const { note, type, outside, discard, shown } = withEditor("start");

      type("T1");
      await idle();
      discard("start");
      await vault.land(0);
      vault.write("X");
      if (note.reconcile()) outside("X");
      await vault.land(1);
      // The refetch the declined event left for once nothing is in the air.
      outside(vault.disk());

      expect(vault.disk()).toBe("X");
      expect(shown()).toBe("X");
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).toBe("saved");
    });

    it("sends keys typed after :e! behind its write, naming that write's answer", async () => {
      const vault = server("start");
      const { note, type, discard } = withEditor("start");

      type("T1");
      await idle();
      discard("start");
      type("start, more");
      await idle();
      await vault.land(0);
      await vault.land(1);
      const restored = vault.disk();
      await vault.land(2);

      expect(saveNote.mock.calls.map((call) => call[1])).toEqual(["T1", "start", "start, more"]);
      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "start, more",
        false,
        noteBase(restored),
      );
      expect(landedAs("start, more", vault.disk())).toBe(true);
      expect(note.status()).toBe("saved");
    });

    it("holds nothing when the write after :e! fails", async () => {
      const vault = server("start");
      const { note, type, discard } = withEditor("start");

      type("T1");
      await idle();
      discard("start");
      await vault.land(0);
      await vault.fail(1);

      expect(saveNote.mock.calls.map((call) => call[1])).toEqual(["T1", "start"]);
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).toBe("saved");
      // Nothing waits to go out: a save writes nothing.
      expect(await note.saved()).toBe(true);
      expect(saveNote).toHaveBeenCalledTimes(2);
    });

    it("writes nothing on :e! with no write in the air", async () => {
      server("start");
      const { type, discard } = withEditor("start");

      type("T1");
      discard("start");
      await idle();
      await settled();

      expect(saveNote).not.toHaveBeenCalled();
    });

    it("holds and sends nothing on hide while the write after :e! waits its turn", async () => {
      const vault = server("start");
      const { note, type, outside, discard, shown } = withEditor("start");

      type("T1");
      await idle();
      discard("start");
      // The page lives on through the hide.
      await background();
      await vault.land(0);
      vault.write("X");
      if (note.reconcile()) outside("X");
      await vault.land(1);
      await vault.land(2);
      // The refetch the declined event left for once nothing is in the air.
      outside(vault.disk());

      expect(vault.disk()).toBe("X");
      expect(shown()).toBe("X");
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).toBe("saved");
    });

    it("names the base on hide when the buffer reopened on the text under a write in the air", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      // The quiet write put nothing in the cache: the editor reopens on "start".
      show("start");
      note.open("index.md");
      type("start T2");
      await pagehide();
      await vault.land(0);
      const first = vault.disk();
      await vault.land(1);
      await vault.land(2);

      // Typed on "start" and not on T1: the vault refuses it, and T1 stands.
      expect(vault.disk()).toBe(first);
      expect(landedAs("T1", vault.disk())).toBe(true);
      expect(heldText("index.md")).toMatchObject({ content: "start T2", conflicted: true });
      expect(note.status()).toBe("conflict");
    });

    it("holds without sending on hide when the buffer reopened on the text under a write in the air", async () => {
      server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      await pagehide();

      // The screen shows "start": a keepalive would land T1 over it unseen.
      expect(saveNote).toHaveBeenCalledTimes(1);
      // W1 dies with the page, so its text is held where the screen is not.
      expect(heldText("index.md")).toMatchObject({ content: "T1", conflicted: false });
      expect(note.restored()).toBe(false);
    });

    it("holds the write in the air off screen against the write it named, so reopening reads no conflict", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T0");
      await idle();
      type("T1");
      note.startSave();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      // W1 goes out behind W0, naming what W0 landed, and never answers.
      await vault.land(0);
      expect(vault.request(1)).toMatchObject({ content: "T1", base: noteBase(vault.disk()) });
      await pagehide();
      expect(saveNote).toHaveBeenCalledTimes(2);

      // The vault holds W0's text, the reader's own: T1 was typed on it.
      const again = reopen(vault.disk(), "T1");
      expect(heldText("index.md")).toMatchObject({ content: "T1" });
      expect(again.status()).not.toBe("conflict");
    });

    it("holds without sending when a phone backgrounds the page reopened on the text under a write in the air", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      await background();

      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(heldText("index.md")).toMatchObject({ content: "T1", conflicted: false });
      expect(note.restored()).toBe(false);
      await vault.land(0);
    });

    it("drops the copy held off screen at hide once the write in the air lands", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      // The page lives on through the hide.
      await background();
      expect(heldText("index.md")).toMatchObject({ content: "T1" });
      await vault.land(0);

      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(landedAs("T1", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).not.toBe("error");
    });

    it("holds and resends on hide once the reopened buffer took the text of the write in the air", async () => {
      const vault = server("start");
      const { note, type, show, outside } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      // The buffer takes the write's text: it follows that write now.
      outside("T1");
      await pagehide();

      expect(vault.request(1)).toMatchObject({ content: "T1", keepalive: true });
      expect(heldText("index.md")).toMatchObject({ content: "T1" });
    });
  });
});
