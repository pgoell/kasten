import { noteAfterPrompt } from "@/components/note-prompt";

describe("what the editor follows", () => {
  it("opens the note a create made", () => {
    expect(noteAfterPrompt("create", "daily/", "daily/note.md", undefined)).toBe("daily/note.md");
  });

  it("follows the note it renamed when that was the note being written", () => {
    // `?note=` has to move with it, or the editor is left pointing at a path
    // the vault no longer has.
    expect(
      noteAfterPrompt("rename", "inbox/borges.md", "reading/borges.md", "inbox/borges.md"),
    ).toBe("reading/borges.md");
  });

  it("stays on the open note when another one was renamed", () => {
    // The tree renames the note under its cursor, which is not always the one
    // being written. Following it would take the editor off mid-sentence.
    expect(
      noteAfterPrompt("rename", "daily/2026-08-05.md", "daily/today.md", "inbox/borges.md"),
    ).toBeUndefined();
  });

  it("stays put when no note is open at all", () => {
    expect(
      noteAfterPrompt("rename", "daily/2026-08-05.md", "daily/today.md", undefined),
    ).toBeUndefined();
  });

  it("carries the open note along when the folder it sat in moved", () => {
    expect(noteAfterPrompt("folder", "inbox", "reading", "inbox/borges.md")).toBe(
      "reading/borges.md",
    );
  });

  it("keeps the rest of the path when a folder moved from deeper in the vault", () => {
    expect(noteAfterPrompt("folder", "inbox", "archive/2026", "inbox/deep/borges.md")).toBe(
      "archive/2026/deep/borges.md",
    );
  });

  it("stays on the open note when a folder it was not in moved", () => {
    expect(noteAfterPrompt("folder", "inbox", "reading", "daily/2026-08-05.md")).toBeUndefined();
  });

  it("stays put when a folder whose name the open note only starts with moved", () => {
    // `inboxes/` is not `inbox/`, and the slash is what keeps the test on a
    // segment boundary.
    expect(noteAfterPrompt("folder", "inbox", "reading", "inboxes/borges.md")).toBeUndefined();
  });

  it("stays put on a folder move with no note open", () => {
    expect(noteAfterPrompt("folder", "inbox", "reading", undefined)).toBeUndefined();
  });
});
