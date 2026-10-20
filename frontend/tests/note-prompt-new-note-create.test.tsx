import { waitFor } from "@testing-library/react";
import { renderPrompt } from "./note-prompt-fixture";

const { createNote, renameNote, moveFolder } = vi.hoisted(() => ({
  createNote: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ createNote }));
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));

describe("the new note prompt", () => {
  beforeEach(() => {
    createNote.mockResolvedValue({ path: "daily/note.md", content: "" });
  });

  afterEach(() => {
    createNote.mockReset();
  });

  it("creates the note the input names and opens it", async () => {
    const prompt = renderPrompt();

    prompt.type("daily/note");
    prompt.press("Enter");

    await waitFor(() => expect(createNote).toHaveBeenCalledWith("daily/note.md"));
    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalledWith("daily/note.md"));
  });

  it("opens the path the vault gave back, not the one that was typed", async () => {
    // The vault answers with the canonical spelling, and that is what `?note=`
    // has to carry or the tree marks nothing.
    createNote.mockResolvedValue({ path: "daily/canonical.md", content: "" });
    const prompt = renderPrompt();

    prompt.type("daily/note");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalledWith("daily/canonical.md"));
  });

  it("seeds the new note's text and asks the tree for a fresh listing", async () => {
    // The canonical spelling again, so that seeding the typed path reads as
    // what it is rather than as seeding the right one.
    createNote.mockResolvedValue({ path: "daily/canonical.md", content: "" });
    const prompt = renderPrompt();
    const invalidate = vi.spyOn(prompt.queryClient, "invalidateQueries");

    prompt.type("daily/note");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());
    expect(prompt.queryClient.getQueryData(["note", "daily/canonical.md"])).toBe("");
    expect(prompt.queryClient.getQueryData(["note", "daily/note.md"])).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["files"] });
  });

  it("sends the one create while the first is still in flight", async () => {
    // Enter repeats while it is held down, and each repeat would be a POST.
    const prompt = renderPrompt();

    prompt.type("daily/note");
    prompt.press("Enter");
    prompt.press("Enter");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());
    expect(createNote).toHaveBeenCalledTimes(1);
  });

  it("tries the create again on the next enter after one failed", async () => {
    createNote.mockRejectedValueOnce(new Error("POST /api/files/daily/note.md failed with 500"));
    const prompt = renderPrompt();

    prompt.type("daily/note");
    prompt.press("Enter");
    await waitFor(() => expect(prompt.hint()).toBe("could not create the note"));

    prompt.press("Enter");

    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalledWith("daily/note.md"));
  });

  it("opens a note that is already there rather than creating it", async () => {
    const prompt = renderPrompt();

    prompt.type("index");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalledWith("index.md"));
    expect(createNote).not.toHaveBeenCalled();
    expect(prompt.hint()).toBe("already exists, Enter opens it");
  });

  it("does nothing on enter while the input names no note", () => {
    const prompt = renderPrompt();

    prompt.type("daily/");
    prompt.press("Enter");

    expect(prompt.hint()).toBe("name the note");
    expect(createNote).not.toHaveBeenCalled();
    expect(prompt.onOpen).not.toHaveBeenCalled();
  });

  it("says which folder the create would make", () => {
    const prompt = renderPrompt();

    prompt.type("reading/borges");

    expect(prompt.hint()).toBe("creates folder reading/");
  });
});
