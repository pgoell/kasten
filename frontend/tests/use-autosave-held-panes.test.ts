import { act } from "@testing-library/react";
import { heldText, holdText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  eachPage,
  idle,
  pagehide,
  pendingSave,
  refused,
  renderAutosave,
  settled,
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

  it("holds a conflicted note as conflicted on leaving, with no flush to fail", async () => {
    // Leaving a conflicted note writes nothing over the vault: the text goes to
    // the held store, and the reader decides on return.
    const note = renderAutosave("index.md");

    note.change("# mine");
    await refused();
    note.change("# mine, more");
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    expect(saveNote).toHaveBeenCalledOnce();
    expect(heldText("index.md")).toMatchObject({
      content: "# mine, more",
      reason: "Changed on disk before the note was left",
      conflicted: true,
    });
  });

  it("holds a conflicted note's text and writes nothing when another note is opened", async () => {
    const note = renderAutosave("index.md");

    note.change("# mine");
    await refused();
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    expect(saveNote).toHaveBeenCalledOnce();
    expect(heldText("index.md")).toMatchObject({ content: "# mine", conflicted: true });
    expect(note.status()).toBe("saved");
  });

  it("holds a conflicted note's text and writes nothing when the editor goes away", async () => {
    const note = renderAutosave("index.md");

    note.change("# mine");
    await refused();
    note.unmount();
    await act(async () => {});

    expect(saveNote).toHaveBeenCalledOnce();
    expect(heldText("index.md")).toMatchObject({ content: "# mine", conflicted: true });
  });

  it("reopens a conflicted note left behind as a conflict, and writes nothing on the quiet period", async () => {
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");

    note.change("# mine");
    await refused();
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    expect(note.allowReload("the index note")).toBe(false);
    await idle();

    expect(saveNote).toHaveBeenCalledOnce();
    expect(note.status()).toBe("conflict");
  });

  it("writes the kept text with :w after a conflicted note is reopened, and drops the held entry", async () => {
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");

    note.change("# mine");
    await refused();
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    note.allowReload("the index note");
    expect(saveNote).toHaveBeenCalledOnce();

    expect(await note.saved()).toBe(true);
    expect(saveNote).toHaveBeenLastCalledWith("index.md", "# mine");
    expect(heldText("index.md")).toBeUndefined();
    expect(note.status()).toBe("saved");
  });

  it("drops a reopened conflict's held text when the vault's read equals it", async () => {
    // Somebody wrote the kept text into the vault before the reopen: the
    // reopen takes it against the stale cache, and the fresh read settles it.
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");

    note.change("# mine");
    await refused();
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    expect(note.allowReload("the index note")).toBe(false);
    expect(note.status()).toBe("conflict");

    expect(note.allowReload("# mine")).toBe(true);
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")).toBeUndefined();
    await idle();
    expect(saveNote).toHaveBeenCalledOnce();
  });

  it("puts held text back in the buffer when its note is reopened", async () => {
    const note = renderAutosave("index.md");
    saveNote.mockRejectedValueOnce(new Error("failed with 500"));
    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    note.open("index.md");
    // The editor opens on the held text and asks about the vault's.
    expect(note.allowReload("the index note")).toBe(false);

    expect(note.status()).toBe("error");
    expect(note.reason()).toBe("failed with 500");
    expect(await note.saved()).toBe(true);
    expect(saveNote).toHaveBeenLastCalledWith("index.md", "# left behind");
    expect(heldText("index.md")).toBeUndefined();
  });

  it("keeps a flush that fails after its note was reopened through the next save of that note", async () => {
    // The reader came back before the flush answered, so the buffer holds the
    // vault's text and not the refused one: a save of that buffer says nothing
    // about the held text, which is still nowhere else.
    const note = renderAutosave("index.md");
    const flush = pendingSave();
    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    await flush.break();
    expect(note.restored()).toBe(false);

    // A reload asked after the failure finds a buffer that never showed it.
    expect(note.allowReload("the index note\nmore")).toBe(true);
    note.change("# typed after coming back");
    await idle();
    await settled();

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "# typed after coming back",
      false,
      noteBase("the index note\nmore"),
    );
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")?.content).toBe("# left behind");
  });

  it("writes nothing on hide while reopened held text is untouched", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");
    note.allowReload("the index note");
    expect(note.restored()).toBe(true);

    await pagehide();
    expect(saveNote).not.toHaveBeenCalled();
    expect(heldText("index.md")?.reason).toBe("failed with 500");

    // Typed into, it is the reader's text again, and the hide writes it.
    note.change("# held and more");
    await pagehide();
    expect(saveNote).toHaveBeenCalledWith("index.md", "# held and more", true);
    expect(heldText("index.md")).toBeUndefined();
  });

  it("takes held text back when the focus returns to a pane still showing it", async () => {
    // A split: the note's editor stayed mounted while the focus was elsewhere,
    // so it asks nothing about the vault's text on the way back.
    const note = renderAutosave("daily/2026-08-05.md", () => "# held");
    note.seed("index.md", "the index note");
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });

    note.open("index.md");

    expect(note.status()).toBe("error");
    expect(await note.saved()).toBe(true);
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "# held",
      false,
      noteBase("the index note"),
    );
  });

  it("leaves held text listed when the focus moves to a pane showing the vault's text", async () => {
    // The note open in a second pane that never showed the refused text:
    // taking it into `pending` there would send the vault's text plus a key.
    const note = renderAutosave("daily/2026-08-05.md", () => "the index note");
    note.seed("index.md", "the index note");
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });

    note.open("index.md");
    note.change("the index note!");
    await idle();
    await settled();

    expect(note.restored()).toBe(false);
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "the index note!",
      false,
      noteBase("the index note"),
    );
    expect(heldText("index.md")?.content).toBe("# held");
  });

  it("leaves held text listed through an outside write to a pane showing the vault's text", async () => {
    const note = renderAutosave("daily/2026-08-05.md", () => "the index note");
    note.seed("index.md", "the index note");
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    note.open("index.md");

    // Somebody else writes the note; the clean buffer takes it.
    expect(note.allowReload("somebody else's note")).toBe(true);

    expect(note.restored()).toBe(false);
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")?.content).toBe("# held");
  });

  /** Pane `a` showing text held for index.md, taken into the buffer. */
  function showingHeld() {
    const screen = { doc: "# held" };
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md", () => screen.doc);
    note.seed("index.md", "the index note");
    expect(note.allowReload("the index note")).toBe(false);
    expect(note.restored()).toBe(true);
    // Pane `b` on the same note shows the vault's text.
    screen.doc = "the index note";
    return note;
  }

  it("keeps held text one pane showed when the reader types in a second pane on the same note", async () => {
    const note = showingHeld();

    note.focus("b");
    note.change("the index note!");
    await idle();
    await settled();

    // The switch is a leave: pane `a`'s text goes out with it.
    expect(saveNote).toHaveBeenCalledWith("index.md", "# held", false, noteBase("the index note"));
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "the index note!",
      false,
      noteBase("the index note"),
    );
  });

  it("keeps held text one pane showed when the reader saves in a second pane on the same note", async () => {
    const note = showingHeld();

    note.focus("b");
    note.change("the index note!");
    await note.save();
    await settled();

    expect(saveNote).toHaveBeenCalledWith("index.md", "# held", false, noteBase("the index note"));
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "the index note!",
      false,
      noteBase("the index note"),
    );
  });

  it("writes a first pane's unsaved text before a second pane on the same note types", async () => {
    const screen = { doc: "the index note" };
    const note = renderAutosave("index.md", () => screen.doc);
    note.seed("index.md", "the index note");
    expect(note.allowReload("the index note")).toBe(true);

    note.change("pane a's text");
    // Inside the quiet period.
    note.focus("b");
    note.change("pane b's text");
    await idle();
    await settled();

    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "pane a's text",
      false,
      noteBase("the index note"),
    );
    // Typed on the vault's text, which pane `a`'s write has moved past: the
    // vault's refusal decides.
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "pane b's text",
      false,
      noteBase("the index note"),
    );
  });

  it("sends nothing on a pane switch on the same note with nothing waiting", async () => {
    const note = renderAutosave("index.md", () => "the index note");
    note.seed("index.md", "the index note");
    expect(note.allowReload("the index note")).toBe(true);

    note.focus("b");
    await idle();
    await settled();

    expect(saveNote).not.toHaveBeenCalled();
    expect(note.status()).toBe("saved");
  });
});
