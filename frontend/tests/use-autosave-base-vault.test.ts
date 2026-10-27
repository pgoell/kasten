import { act } from "@testing-library/react";
import { ChangedOnDisk } from "@/lib/api";
import { heldText } from "@/lib/held-text";
import { forgetQueues } from "@/lib/note/use-autosave";
import { noteBase } from "@/lib/note-base";
import { eachPage, idle, pagehide, renderAutosave, settled } from "./autosave-fixture";

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
    /**
     * A vault that refuses a stale base, landing each write as the text with
     * its `modified` line restamped. Returns the text on disk, read live.
     */
    function vault(start: string) {
      let disk = start;
      const land = (content: string, base?: string) => {
        if (base !== undefined && base !== noteBase(disk)) throw new ChangedOnDisk();
        disk = content.replace(/\n---\n/, "\nmodified: now\n---\n");
        return { path: "index.md", content: disk };
      };
      saveNote.mockImplementation(
        async (_path: string, content: string, _k?: boolean, base?: string) => land(content, base),
      );
      /** The next write, held until the returned call lets it reach the vault. */
      const held = () => {
        let release: (() => Promise<void>) | undefined;
        saveNote.mockImplementationOnce(
          (_path: string, content: string, _k?: boolean, base?: string) =>
            new Promise((resolve, reject) => {
              release = async () => {
                try {
                  resolve(land(content, base));
                } catch (error) {
                  if (!(error instanceof ChangedOnDisk)) throw error;
                  reject(error);
                }
              };
            }),
        );
        return () => act(async () => release?.());
      };
      return { held, disk: () => disk };
    }

    it("names the write in the air as the keepalive's base, so text typed behind it lands", async () => {
      const note = renderAutosave();
      const server = vault("---\nid: a\n---\nzero");
      note.seed("index.md", "---\nid: a\n---\nzero");
      const first = server.held();
      const keepalive = server.held();

      note.change("---\nid: a\n---\none");
      await idle();
      note.change("---\nid: a\n---\ntwo");
      await pagehide();
      await first();
      await keepalive();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "---\nid: a\n---\ntwo",
        true,
        noteBase("---\nid: a\n---\none"),
      );
      expect(server.disk()).toBe("---\nid: a\nmodified: now\n---\ntwo");
      expect(note.cached("index.md")).toBe("---\nid: a\nmodified: now\n---\ntwo");
      expect(heldText("index.md")).toBeUndefined();
    });

    it("holds a queued write that fails against what the write ahead of it landed", async () => {
      const note = renderAutosave();
      const server = vault("---\nid: a\n---\nzero");
      note.seed("index.md", "---\nid: a\n---\nzero");
      const first = server.held();
      saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      note.change("---\nid: a\n---\none");
      await idle();
      note.change("---\nid: a\n---\ntwo");
      note.startSave();
      await first();
      await settled();

      expect(heldText("index.md")?.after).toBe(server.disk());
      // The next page, opening the note on what the vault holds.
      forgetQueues();
      const again = renderAutosave("index.md");
      expect(again.allowReload(server.disk())).toBe(false);
      expect(again.status()).toBe("error");
    });

    it("holds text typed behind a write in the air at hide against that write's text", async () => {
      const note = renderAutosave();
      const server = vault("---\nid: a\n---\nzero");
      note.seed("index.md", "---\nid: a\n---\nzero");
      const first = server.held();
      let drop: (() => void) | undefined;
      saveNote.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            drop = () => reject(new TypeError("Failed to fetch"));
          }),
      );

      note.change("---\nid: a\n---\none");
      await idle();
      note.change("---\nid: a\n---\ntwo");
      await pagehide();
      await first();
      await act(async () => drop?.());

      forgetQueues();
      const again = renderAutosave("index.md");
      expect(again.allowReload(server.disk())).toBe(false);
      expect(again.status()).toBe("error");
    });

    it("names the text read for :e! as its base after the cache moves under a dirty buffer", async () => {
      const note = renderAutosave();
      const server = vault("the index note");
      note.seed("index.md", "the index note");

      note.change("# edited");
      await idle();
      // The route reads the vault into the cache, then throws the buffer away.
      note.seed("index.md", server.disk());
      note.revert(true);
      note.change("# typed after :e!");
      // A highlight lands, and the cache follows it; the dirty editor declines it.
      note.seed("index.md", "a highlight");
      vault("a highlight");
      await idle();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# typed after :e!",
        false,
        noteBase("# edited"),
      );
      expect(note.status()).toBe("conflict");
    });

    it("names the cached text as its base on returning to a pane whose editor stayed mounted", async () => {
      let doc = "the index note";
      const note = renderAutosave("other.md", () => doc);
      note.seed("index.md", "the index note");

      note.open("index.md");
      doc = "the index note!";
      note.change(doc);
      note.seed("index.md", "a highlight");
      vault("a highlight");
      await idle();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "the index note!",
        false,
        noteBase("the index note"),
      );
      expect(note.status()).toBe("conflict");
    });
  });
});
