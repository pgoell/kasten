import { act } from "@testing-library/react";
import { ChangedOnDisk } from "@/lib/api";
import { heldText, holdText } from "@/lib/held-text";
import { forgetQueues } from "@/lib/note/use-autosave";
import { noteBase } from "@/lib/note-base";
import {
  eachPage,
  heldRows,
  idle,
  pagehide,
  pendingSave,
  renderAutosave,
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

  it("offers no entry a pane does not show after its shown entry was found landed", async () => {
    // The pane stayed mounted on the oldest entry, which the vault came to hold.
    const note = renderAutosave("daily/2026-08-05.md", () => "# first");
    note.seed("index.md", "# first");
    holdText("index.md", { content: "# first", reason: "failed with 500", conflicted: false });
    holdText("index.md", { content: "# second", reason: "failed with 502", conflicted: false });

    note.open("index.md");
    expect(note.allowReload("somebody else's note")).toBe(true);

    expect(note.restored()).toBe(false);
    expect(heldText("index.md")?.content).toBe("# second");
  });

  it("reopens text held at hide as not saved when the write in the air never reached the vault", async () => {
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");
    // The page dies under both: the quiet write never arrives, and nobody
    // hears how the keepalive went.
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    saveNote.mockImplementationOnce(() => new Promise(() => {}));

    note.change("# one");
    await idle();
    note.change("# two");
    await pagehide();

    forgetQueues();
    const again = renderAutosave("index.md");
    expect(again.allowReload("the index note")).toBe(false);
    expect(again.status()).toBe("error");
  });

  it("drops only the taken entry when it is saved, and offers the next on the next opening", async () => {
    holdText("index.md", { content: "# first", reason: "failed with 500", conflicted: false });
    holdText("index.md", { content: "# second", reason: "failed with 502", conflicted: false });
    const note = renderAutosave("index.md");

    expect(note.allowReload("the index note")).toBe(false);
    expect(await note.saved()).toBe(true);
    expect(saveNote).toHaveBeenLastCalledWith("index.md", "# first");
    expect(heldText("index.md")?.content).toBe("# second");

    note.open("other.md");
    note.open("index.md");
    expect(note.allowReload(written("# first").content)).toBe(false);
    expect(note.reason()).toBe("failed with 502");
  });

  it("drops only the entry the buffer showed on :e!", async () => {
    holdText("index.md", { content: "# first", reason: "failed with 500", conflicted: false });
    holdText("index.md", { content: "# second", reason: "failed with 502", conflicted: false });
    const note = renderAutosave("index.md");
    note.allowReload("the index note");

    note.revert(true);
    expect(heldText("index.md")?.content).toBe("# second");
    // A buffer that took no held text throws none away.
    note.revert(true);
    expect(heldText("index.md")?.content).toBe("# second");
  });

  it("holds one entry for the hide and the failure of the same write", async () => {
    const note = renderAutosave("index.md");
    const quiet = pendingSave();
    note.change("# sent quietly");
    await idle();
    saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await pagehide();
    await quiet.break();

    expect(heldRows()).toHaveLength(1);
  });

  it("keeps text another tab held for the note through this tab's failed write", async () => {
    const note = renderAutosave("index.md");
    // A tab of the old build, still open after the deploy.
    localStorage.setItem(
      "kasten.held",
      JSON.stringify({
        "index.md": { content: "# theirs", reason: "failed with 500", conflicted: false },
      }),
    );

    note.change("# mine");
    saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await idle();

    expect(heldText("index.md")?.content).toBe("# theirs");
    expect(heldRows()).toHaveLength(2);
  });

  it("reopens held text as conflicted when the vault moved since it was held", async () => {
    saveNote.mockRejectedValue(new TypeError("Failed to fetch"));
    const left = renderAutosave("index.md");
    left.seed("index.md", "the index note");
    left.change("# mine");
    await pagehide();
    expect(heldText("index.md")?.base).toBe("the index note");
    left.unmount();
    await act(async () => {});

    // Somebody else wrote the note before it was opened again.
    const note = renderAutosave("index.md");
    expect(note.allowReload("somebody else's note")).toBe(false);

    expect(note.status()).toBe("conflict");
    expect(await note.saveFirst()).toBe(false);
  });

  it("writes nothing on its own when a held note is reopened", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");

    expect(note.allowReload("the index note")).toBe(false);
    await idle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(note.status()).toBe("error");
  });

  it("does not take held text a second time while its write is in the air", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");
    note.allowReload("the index note");
    const write = pendingSave();
    note.startSave();

    // The write's own echo, read while the entry is still there.
    expect(note.allowReload("# held\nmodified: now")).toBe(true);
    await write.finish();
    expect(heldText("index.md")).toBeUndefined();
  });

  it("still shows an outside write as a conflict after a held note is reopened", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");
    note.allowReload("the index note");

    expect(note.reconcile()).toBe(false);
    saveNote.mockRejectedValueOnce(new ChangedOnDisk());
    await note.save();

    expect(saveNote).toHaveBeenCalledWith("index.md", "# held", false, noteBase("the index note"));
    expect(note.status()).toBe("conflict");
  });

  it("reopens a note held while conflicted as conflicted", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: true });
    const note = renderAutosave("index.md");

    expect(note.allowReload("the index note")).toBe(false);

    expect(note.status()).toBe("conflict");
    expect(await note.saveFirst()).toBe(false);
  });

  it("drops held text the vault already holds, the stamp aside", async () => {
    // A keepalive write that landed after the page was gone.
    const held = "---\nmodified: 2026-10-14T10:00:00+00:00\n---\n# held";
    holdText("index.md", { content: held, reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");

    expect(note.allowReload("---\nmodified: 2026-10-14T10:00:03+00:00\n---\n# held")).toBe(true);

    expect(heldText("index.md")).toBeUndefined();
    expect(note.status()).toBe("saved");
  });

  it("drops held text on :e!", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");
    note.allowReload("the index note");

    note.revert(true);

    expect(heldText("index.md")).toBeUndefined();
    expect(note.status()).toBe("saved");
  });

  it("drops held text of a note with no block once the vault holds it stamped", async () => {
    // The keepalive landed after the page was gone, and the vault gave the note
    // the block every write of one without it gets.
    holdText("index.md", { content: "# held", reason: "hidden", conflicted: false });
    const note = renderAutosave("index.md");

    expect(
      note.allowReload(
        "---\nid: 0199\ncreated: 2026-10-14T10:00:00+00:00\ntype: Note\nmodified: 2026-10-14T10:00:00+00:00\n---\n# held",
      ),
    ).toBe(true);

    expect(heldText("index.md")).toBeUndefined();
    expect(note.status()).toBe("saved");
  });

  it("keeps held text whose type the vault does not hold", async () => {
    holdText("index.md", {
      content: "---\nid: 0199\ntype: Book\n---\n# held",
      reason: "hidden",
      conflicted: false,
    });
    const note = renderAutosave("index.md");

    expect(note.allowReload("---\nid: 0199\ntype: Note\nmodified: now\n---\n# held")).toBe(false);

    expect(heldText("index.md")?.content).toBe("---\nid: 0199\ntype: Book\n---\n# held");
    expect(note.restored()).toBe(true);
  });
});
