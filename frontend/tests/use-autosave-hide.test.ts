import { act } from "@testing-library/react";
import { heldText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import {
  background,
  eachPage,
  idle,
  pagehide,
  pendingSave,
  refused,
  renderAutosave,
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

  it("writes the waiting text with keepalive when the page is hidden", async () => {
    const note = renderAutosave("index.md");

    note.change("# typed just now");
    await pagehide();

    expect(saveNote).toHaveBeenCalledWith("index.md", "# typed just now", true);
  });

  it("writes the waiting text when a phone backgrounds the page, and says how it went", async () => {
    const note = renderAutosave("index.md");

    note.change("# typed just now");
    await background();

    expect(saveNote).toHaveBeenCalledWith("index.md", "# typed just now", true);
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")).toBeUndefined();
  });

  it("holds and resends a quiet write still in flight when the page is hidden", async () => {
    const note = renderAutosave("index.md");
    note.allowReload("# on disk");
    pendingSave();
    note.change("# sent quietly");
    await idle();
    // The keepalive that never answers: the page went away under it.
    saveNote.mockImplementationOnce(() => new Promise(() => {}));

    await pagehide();

    expect(heldText("index.md")?.content).toBe("# sent quietly");
    // The same text as the write in the air, so the same base: it lands if
    // that write was cancelled, and is the server's no-op if that write landed.
    const quietBase = saveNote.mock.calls[0]?.[3];
    expect(quietBase).toBeDefined();
    expect(saveNote).toHaveBeenNthCalledWith(2, "index.md", "# sent quietly", true, quietBase);
  });

  it("holds and resends a quiet write still in flight when a phone backgrounds the page", async () => {
    const note = renderAutosave("index.md");
    note.allowReload("# on disk");
    pendingSave();
    note.change("# sent quietly");
    await idle();
    saveNote.mockImplementationOnce(() => new Promise(() => {}));

    await background();

    expect(heldText("index.md")?.content).toBe("# sent quietly");
    const quietBase = saveNote.mock.calls[0]?.[3];
    expect(quietBase).toBeDefined();
    expect(saveNote).toHaveBeenNthCalledWith(2, "index.md", "# sent quietly", true, quietBase);
  });

  it("drops the copy held at hide time once the quiet write lands", async () => {
    const note = renderAutosave("index.md");
    const quiet = pendingSave();
    note.change("# sent quietly");
    await idle();
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    await pagehide();
    expect(heldText("index.md")?.content).toBe("# sent quietly");

    await quiet.finish();

    expect(heldText("index.md")).toBeUndefined();
  });

  it("holds and sends text typed after the quiet write went out, not the quiet write's", async () => {
    const note = renderAutosave("index.md");
    pendingSave();
    note.change("# sent quietly");
    await idle();
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    note.change("# typed after");

    await pagehide();

    expect(heldText("index.md")?.content).toBe("# typed after");
    expect(saveNote).toHaveBeenCalledTimes(2);
    expect(saveNote).toHaveBeenNthCalledWith(
      2,
      "index.md",
      "# typed after",
      true,
      noteBase("# sent quietly"),
    );
  });

  it("holds and sends nothing on hide when the quiet write in flight was thrown away", async () => {
    const note = renderAutosave("index.md");
    pendingSave();
    note.change("# thrown away");
    await idle();
    note.revert(true);

    await pagehide();

    expect(heldText("index.md")).toBeUndefined();
    expect(saveNote).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the page is shown again", async () => {
    const note = renderAutosave("index.md");

    note.change("# typed just now");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(saveNote).not.toHaveBeenCalled();
  });

  it("keeps the text held when the keepalive write is refused at hide time", async () => {
    // Over 64 KiB, or the network already gone: fetch rejects with a TypeError.
    const note = renderAutosave("index.md");
    saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    note.change("# typed just now");
    await pagehide();

    expect(heldText("index.md")?.content).toBe("# typed just now");
    expect(note.status()).toBe("error");
  });

  it("holds the text without writing when the page is hidden while conflicted", async () => {
    const note = renderAutosave("index.md");

    note.change("# mine");
    await refused();
    note.change("# mine, more");
    await pagehide();

    expect(saveNote).toHaveBeenCalledOnce();
    expect(heldText("index.md")).toEqual({
      content: "# mine, more",
      reason: "Not yet written when the page was hidden",
      conflicted: true,
    });
  });

  it("does not call the next note saved when the old note's flush answers late", async () => {
    const note = renderAutosave("index.md");
    const flush = pendingSave();
    const daily = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.change("# daily");
    note.startSave();
    await flush.finish();

    expect(note.status()).toBe("saving");
    expect(note.cached("daily/2026-08-05.md")).toBeUndefined();
    await daily.finish();
  });
});
