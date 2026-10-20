import { heldText, heldTexts, landedAs } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  background,
  eachPage,
  idle,
  pagehide,
  reopen,
  server,
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
    it("keeps a quiet write's text when it fails after the buffer reopened on the text under it", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      await vault.fail(0);

      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(heldText("index.md")).toMatchObject({ content: "T1" });
    });

    /** T1's flush in the air, the buffer reopened on it within the route and typed on. */
    function typedOnTheFlush() {
      const vault = server("start");
      const { note, type, show } = withEditor("start");
      type("T1");
      note.seed("b.md", "b");
      note.open("b.md");
      note.open("index.md");
      show(String(note.cached("index.md")));
      note.allowReload(String(note.cached("index.md")));
      type("T1, T2");
      return { vault, note };
    }

    it("names the flush's answer when it lands in the quiet period after a reopen on its text", async () => {
      const { vault, note } = typedOnTheFlush();
      await vault.land(0);
      const flushed = vault.disk();
      await idle();
      await vault.land(1);

      // The queue drained before the quiet write went out, and the buffer was
      // typed on W1's text: it names W1's stamped answer, not "start" (#389).
      expect(vault.request(1)).toMatchObject({ content: "T1, T2", base: noteBase(flushed) });
      expect(landedAs("T1, T2", vault.disk())).toBe(true);
      expect(note.status()).not.toBe("conflict");
    });

    it("names the old base when the flush fails in the quiet period after a reopen on its text", async () => {
      const { vault, note } = typedOnTheFlush();
      await vault.fail(0);
      await idle();
      await vault.land(1);

      // The vault still holds "start", and T1, typed over since, stays held.
      expect(vault.request(1)).toMatchObject({ content: "T1, T2", base: noteBase("start") });
      expect(landedAs("T1, T2", vault.disk())).toBe(true);
      expect(note.status()).not.toBe("conflict");
      expect(heldText("index.md")).toMatchObject({ content: "T1" });
    });

    /** T1's quiet write in the air, the buffer reopened on "start" and typed on. */
    function typedOnTheTextUnder() {
      const vault = server("start");
      const editor = withEditor("start");
      editor.type("T1");
      return {
        vault,
        editor,
        reopenAndType: async () => {
          await idle();
          editor.note.seed("b.md", "b");
          editor.note.open("b.md");
          editor.show("start");
          editor.note.open("index.md");
          editor.type("start T2");
        },
      };
    }

    it("holds the write in the air off screen beside text typed on the text under it when the page dies at hide", async () => {
      const { vault, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await pagehide();
      // W1 dies with the page; the keepalive names "start" and lands.
      expect(vault.request(1)).toMatchObject({ content: "start T2", keepalive: true });
      await vault.arrive(1);

      expect(landedAs("start T2", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2"]);
      // The next page opens on T1, which the vault never got.
      expect(heldText("index.md", vault.disk())).toMatchObject({ content: "T1" });
      const again = reopen(vault.disk(), "T1");
      expect(again.restored()).toBe(true);
    });

    it("holds the write in the air beside text typed on the text under it when a phone backgrounds the page and it dies", async () => {
      const { vault, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await background();
      await vault.arrive(1);

      expect(landedAs("start T2", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2"]);
    });

    it("drops the copy of the write in the air once it lands after a hide with text typed on the text under it", async () => {
      const { vault, editor, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      // The page lives on through the hide.
      await pagehide();
      await vault.land(0);
      await vault.land(1);

      expect(landedAs("T1", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([
        expect.objectContaining({ content: "start T2", conflicted: true }),
      ]);
      expect(editor.note.status()).toBe("conflict");
    });

    it("holds the write in the air once when the vault refuses it after the keepalive of text typed on the text under it", async () => {
      const { vault, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await pagehide();
      await vault.land(1);
      await vault.land(0);

      expect(landedAs("start T2", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([
        expect.objectContaining({ content: "T1", conflicted: true }),
      ]);
    });

    it("holds the write in the air once when it fails after a hide with text typed on the text under it", async () => {
      const { vault, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await pagehide();
      await vault.fail(0);

      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2"]);
      await vault.land(1);
      expect(landedAs("start T2", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1"]);
    });

    it("drops the copy of the write in the air on reopening once it reached the vault before the page died", async () => {
      const { vault, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await pagehide();
      // W1 reaches the vault, then the keepalive naming "start" is refused there.
      await vault.arrive(0);
      await vault.arrive(1);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2"]);

      // The next page opens on the oldest entry, T1, which the vault holds.
      reopen(vault.disk(), "T1");
      expect(landedAs("T1", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["start T2"]);
    });

    it("holds the write in the air off screen when the page dies with a quiet write of the reopened buffer queued behind it", async () => {
      const { vault, editor, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      // W2 of "start T2" waits behind W1; the keepalive follows W2, not W1.
      await idle();
      editor.type("start T2b");
      await pagehide();
      expect(vault.request(1)).toMatchObject({
        content: "start T2b",
        keepalive: true,
        base: noteBase("start"),
      });
      await vault.arrive(1);

      expect(landedAs("start T2b", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2b"]);
    });

    it("holds the write in the air off screen when a phone backgrounds the page with a quiet write of the reopened buffer queued behind it", async () => {
      const { vault, editor, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await idle();
      editor.type("start T2b");
      await background();
      await vault.arrive(1);

      expect(landedAs("start T2b", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2b"]);
    });

    it("keeps the write in the air on disk when it lands after a hide with a quiet write of the reopened buffer queued behind it", async () => {
      const { vault, editor, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await idle();
      editor.type("start T2b");
      // The page lives on through the hide.
      await pagehide();
      await vault.land(0);
      await vault.land(1);
      await vault.land(2);

      // Typed on "start" and not on T1: the vault refuses both, and T1 stands.
      expect(landedAs("T1", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([
        expect.objectContaining({ content: "start T2b", conflicted: true }),
      ]);
      expect(editor.note.status()).toBe("conflict");
    });

    it("names the reopened buffer's own write on hide once it went out with the text of the write it never took", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      // The same text typed again on "start": W2 waits behind W1.
      type("T1");
      await idle();
      await vault.land(0);
      expect(vault.request(1)).toMatchObject({ content: "T1", keepalive: false });
      type("T1 more");
      await pagehide();
      expect(vault.request(2)).toMatchObject({ content: "T1 more", keepalive: true });
      await vault.land(1);
      await vault.land(2);

      expect(landedAs("T1 more", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).toBe("saved");
    });

    it("holds a queued write off screen when the page dies with the reopened buffer's write queued behind it", async () => {
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
      type("start T2");
      await idle();
      type("start T2b");
      await pagehide();
      // W0 is the only write that went out; the keepalive names the base.
      expect(vault.request(1)).toMatchObject({
        content: "start T2b",
        keepalive: true,
        base: noteBase("start"),
      });

      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2b"]);
    });
  });
});
