import { heldText, heldTexts, landedAs } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  eachPage,
  heldRows,
  idle,
  type renderAutosave,
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
    describe("a live conflict the vault comes to settle (#269)", () => {
      /** Somebody else's write of `text`, stamped as `PUT` stamps it. */
      const stamped = (text: string) => `---\nmodified: other\n---\n${text}`;

      /** "T1" typed on "start", refused over somebody else's "X". */
      async function standing() {
        const vault = server("start");
        const editor = withEditor("start");
        editor.type("T1");
        vault.write("X");
        await idle();
        await vault.land(0);
        expect(editor.note.status()).toBe("conflict");
        return { vault, ...editor };
      }

      /** An outside write's event, and the refetch the route makes when told yes. */
      function event(
        vault: ReturnType<typeof server>,
        outside: (text: string) => void,
        note: ReturnType<typeof renderAutosave>,
      ) {
        if (note.reconcile()) outside(vault.disk());
      }

      it("clears a live conflict once another writer writes the buffer's text", async () => {
        const { vault, note, outside, shown } = await standing();

        vault.write(stamped("T1"));
        event(vault, outside, note);

        expect(note.status()).toBe("saved");
        expect(landedAs("T1", shown())).toBe(true);
      });

      it("keeps a live conflict and the buffer when another writer writes other text", async () => {
        const { vault, note, outside, shown } = await standing();

        vault.write(stamped("Y"));
        event(vault, outside, note);

        expect(note.status()).toBe("conflict");
        expect(shown()).toBe("T1");
        expect(heldText("index.md")).toMatchObject({ content: "T1", conflicted: true });
      });

      it("writes the next key on the vault's text once a live conflict cleared itself", async () => {
        const { vault, note, outside, type } = await standing();

        vault.write(stamped("T1"));
        event(vault, outside, note);
        type("T1 more");
        await idle();
        await vault.land(1);

        expect(saveNote).toHaveBeenLastCalledWith(
          "index.md",
          "T1 more",
          false,
          noteBase(stamped("T1")),
        );
        expect(landedAs("T1 more", vault.disk())).toBe(true);
        expect(note.status()).toBe("saved");
      });

      it("drops the held entry of a live conflict that cleared itself", async () => {
        const { vault, note, outside } = await standing();
        expect(heldTexts("index.md")).toHaveLength(1);

        vault.write(stamped("T1"));
        event(vault, outside, note);

        expect(heldTexts("index.md")).toEqual([]);
        expect(heldRows()).toEqual([]);
      });

      it("declines and marks missed the buffer's text written while :w of a conflict is in the air", async () => {
        const { vault, note } = await standing();
        const invalidate = vi.spyOn(note.client, "invalidateQueries");

        note.startSave();
        vault.write(stamped("T1"));
        expect(note.reconcile()).toBe(false);
        expect(invalidate).not.toHaveBeenCalled();
        await vault.land(1);

        expect(invalidate).toHaveBeenCalledWith(
          { queryKey: ["note", "index.md"] },
          { cancelRefetch: false },
        );
      });
    });
  });
});
