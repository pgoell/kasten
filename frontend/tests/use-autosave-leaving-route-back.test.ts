import { heldText, heldTexts, landedAs } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  background,
  cameBack,
  eachPage,
  heldRows,
  idle,
  left,
  pagehide,
  renderAutosave,
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
    describe("leaving the route with a write in the air (#382)", () => {
      it("holds text typed after the route came back as an error when a phone backgrounds the page and it dies", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { type: retype } = cameBack(note);
        retype("T2");
        await background();
        expect(vault.request(1)).toMatchObject({ content: "T2", keepalive: true });
        await vault.arrive(1);

        expect(vault.disk()).toBe("start");
        const back = reopen(vault.disk(), "T2");
        expect(heldText("index.md")?.content).toBe("T2");
        expect(back.status()).toBe("error");
      });

      it("keeps the flush held when the route comes back on it before it answers", async () => {
        // The cache holds the flush's text because the leave put it there, not
        // because the vault does: a page closed now still cancels the flush.
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const again = renderAutosave("index.md", () => "T1", note.client);
        expect(again.allowReload("T1")).toBe(true);
        expect(again.status()).toBe("saved");
        expect(heldRows()).toHaveLength(1);
        await pagehide();

        expect(vault.request(1)).toBeUndefined();
        expect(heldTexts("index.md")).toEqual([left("T1")]);
      });

      it("drops the flush held when it lands after the route came back on it", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const again = renderAutosave("index.md", () => "T1", note.client);
        again.allowReload("T1");
        await vault.land(0);

        expect(heldTexts("index.md")).toEqual([]);
        expect(again.status()).toBe("saved");
      });

      it("takes the leave flush's failure into the buffer that came back on it", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, type: retype } = cameBack(note);
        await vault.fail(0);

        expect(again.status()).toBe("error");
        expect(heldTexts("index.md")).toHaveLength(1);
        expect(again.taken()).toBe(heldTexts("index.md")[0]);
        // The vault never moved off "start", so the next write names it.
        retype("T1x");
        await idle();
        expect(vault.request(1)).toMatchObject({ content: "T1x", base: noteBase("start") });
        await vault.land(1);
        expect(again.status()).toBe("saved");
        expect(heldTexts("index.md")).toEqual([]);
      });

      it("writes the text :e! chose behind the leave flush after the route came back", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, show } = cameBack(note);
        // `:e!`: the route reads the vault into the cache, then asks.
        again.seed("index.md", "start");
        expect(again.revert(true)).toBe(true);
        show("start");
        expect(vault.request(1)).toBeUndefined();
        await vault.land(0);
        expect(vault.request(1)).toMatchObject({ content: "start", base: noteBase(vault.disk()) });
        await vault.land(1);

        expect(landedAs("start", vault.disk())).toBe(true);
        expect(landedAs("start", String(again.cached("index.md")))).toBe(true);
        expect(again.status()).toBe("saved");
        expect(heldTexts("index.md")).toEqual([]);
      });

      it("holds nothing when the leave flush fails after :e! once the route came back", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, show } = cameBack(note);
        again.seed("index.md", "start");
        again.revert(true);
        show("start");
        await vault.fail(0);
        await vault.land(1);

        expect(landedAs("start", vault.disk())).toBe(true);
        expect(heldTexts("index.md")).toEqual([]);
        expect(again.status()).toBe("saved");
      });

      it("names the text :e! chose after the route came back when the leave flush is refused", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, type: retype, show } = cameBack(note);
        vault.write("X");
        again.seed("index.md", "X");
        again.revert(true);
        show("X");
        await vault.land(0);
        // The write putting X back fails, so only `:e!` told the buffer of X.
        await vault.fail(1);
        retype("X2");
        await idle();
        expect(vault.request(2)).toMatchObject({ content: "X2", base: noteBase("X") });
        await vault.land(2);

        expect(landedAs("X2", vault.disk())).toBe(true);
        expect(again.status()).toBe("saved");
      });

      it("keeps text typed after the route came back when the note is reopened within the route on the leave flush's text", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, type: retype, show } = cameBack(note);
        retype("T1 T2");
        await idle();
        again.seed("b.md", "b");
        show("b");
        again.open("b.md");
        // The cache still holds the leave's T1, and the entry of it: the
        // editor opens on T1, which W2's "T1 T2" was typed over.
        show("T1");
        again.open("index.md");
        again.allowReload("T1");
        retype("T1 k");
        await idle();
        await vault.land(0);
        await vault.land(1);
        await vault.land(2);

        expect(landedAs("T1 T2", vault.disk())).toBe(true);
        expect(again.status()).toBe("conflict");
        expect(heldTexts("index.md").map((entry) => entry.content)).toContain("T1 k");
      });

      it("names the leave flush's answer for text typed after the route came back", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, type: retype } = cameBack(note);
        retype("T1 T2");
        await idle();
        expect(vault.request(1)).toBeUndefined();
        await vault.land(0);
        expect(vault.request(1)).toMatchObject({ content: "T1 T2", base: noteBase(vault.disk()) });
        await vault.land(1);

        expect(landedAs("T1 T2", vault.disk())).toBe(true);
        expect(heldTexts("index.md")).toEqual([]);
        expect(again.status()).toBe("saved");
      });

      it("holds both texts when the leave flush is refused after the route came back and text was typed", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, type: retype } = cameBack(note);
        retype("T1 T2");
        await idle();
        vault.write("X");
        await vault.land(0);
        await vault.land(1);

        expect(vault.disk()).toBe("X");
        expect(again.status()).toBe("conflict");
        // T2 was typed on T1 and carries it: one entry, with both.
        expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1 T2"]);
      });

      it("keeps another note's queue apart after the route came back", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        note.seed("b.md", "b");
        const { again, type: retype } = cameBack(note, "b.md");
        expect(again.isWriting("index.md")).toBe(true);
        expect(again.isWriting("b.md")).toBe(false);
        retype("b2");
        await idle();
        expect(vault.request(1)).toMatchObject({ content: "b2" });
        await vault.fail(0);

        expect(again.status()).toBe("saving");
        expect(again.restored()).toBe(false);
        expect(heldText("b.md")).toBeUndefined();
      });

      it("refuses :e after the route came back while the leave flush is in the air", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again } = cameBack(note);

        expect(again.revert(false)).toBe(false);
        await vault.land(0);
        expect(again.revert(false)).toBe(true);
      });

      it("lets a rename after the route came back wait for the leave flush, and refuses when it fails", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again } = cameBack(note);
        let answer: boolean | undefined;
        void again.askSaveFirst().then((landed) => {
          answer = landed;
        });
        await settled();
        expect(answer).toBeUndefined();
        await vault.fail(0);

        expect(answer).toBe(false);
      });
    });
  });
});
