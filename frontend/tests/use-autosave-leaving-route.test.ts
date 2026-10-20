import { heldText, heldTexts, resetHeld } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  background,
  eachPage,
  heldRows,
  idle,
  left,
  pagehide,
  renderAutosave,
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
    describe("leaving the route with a write in the air (#382)", () => {
      it("holds the flush on leaving the route when the page goes before it answers", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        await pagehide();

        expect(vault.request(0)).toMatchObject({ content: "T1", keepalive: false });
        expect(heldTexts("index.md")).toEqual([left("T1")]);
      });

      it("holds a quiet write in the air on leaving the route with nothing waiting", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        await idle();
        note.unmount();
        await pagehide();

        expect(vault.request(1)).toBeUndefined();
        expect(heldTexts("index.md")).toEqual([left("T1")]);
      });

      it("holds the flush on leaving the route when a phone backgrounds the app before it answers", async () => {
        server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        await background();

        expect(heldTexts("index.md")).toEqual([left("T1")]);
      });

      it("offers the flush on leaving the route after a reload that cancelled it (#381)", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        await idle();
        type("T2");
        note.unmount();
        // The reload: the page and its writes are gone, storage is not.
        resetHeld();
        expect(heldTexts("index.md")).toEqual([{ ...left("T2"), after: "T1" }]);

        const again = reopen(vault.disk(), "T2");
        expect(again.status()).toBe("error");
        expect(heldText("index.md")?.content).toBe("T2");
      });

      it("drops the text held on leaving the route once the flush lands", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        expect(heldTexts("index.md")).toHaveLength(1);
        await vault.land(0);

        expect(heldTexts("index.md")).toEqual([]);
        expect(heldRows()).toEqual([]);
      });

      it("drops the text held on leaving the route once the quiet write in the air lands", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        await idle();
        note.unmount();
        expect(heldTexts("index.md")).toHaveLength(1);
        await vault.land(0);

        expect(heldTexts("index.md")).toEqual([]);
        expect(heldRows()).toEqual([]);
      });

      it("keeps one entry when the flush on leaving the route fails", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        await vault.fail(0);

        expect(heldTexts("index.md")).toMatchObject([
          { content: "T1", reason: "PUT /api/files/index.md failed with 500" },
        ]);
      });

      it("holds nothing on leaving the route once every write answered", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        await idle();
        await vault.land(0);
        note.unmount();
        await pagehide();

        expect(saveNote).toHaveBeenCalledOnce();
        expect(heldRows()).toEqual([]);
      });

      it("never lands the flush over text typed after the route came back", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        // The editor mounted again on the route's cache, which the leave put
        // the flush's text in.
        let doc = "T1";
        const again = renderAutosave("index.md", () => doc, note.client);
        expect(again.allowReload("T1")).toBe(true);
        doc = "T2";
        again.change("T2");
        await pagehide();
        expect(vault.request(1)).toMatchObject({
          content: "T2",
          keepalive: true,
          base: noteBase("T1"),
        });
        // The page is gone: the flush was cancelled and the keepalive is refused.
        await vault.arrive(1);

        expect(vault.disk()).toBe("start");
        // Typed on the flush's text, over the vault's own: nobody else wrote.
        expect(heldTexts("index.md")).toMatchObject([
          { content: "T2", base: "start", after: "T1" },
        ]);
        const back = reopen(vault.disk(), "T2");
        expect(heldText("index.md")?.content).toBe("T2");
        expect(back.status()).toBe("error");
      });
    });
  });
});
