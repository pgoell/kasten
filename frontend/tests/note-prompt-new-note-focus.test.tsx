import { fireEvent, waitFor } from "@testing-library/react";
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

  it("opens on the folder it was given, with the caret in the input", () => {
    const prompt = renderPrompt("daily/");

    expect(prompt.input).toHaveValue("daily/");
    expect(prompt.input).toHaveFocus();
  });

  it("keeps the typed path when the create fails, and says so", async () => {
    createNote.mockRejectedValue(new Error("POST /api/files/daily/note.md failed with 500"));
    const prompt = renderPrompt();

    prompt.type("daily/note");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.hint()).toBe("could not create the note"));
    expect(prompt.input).toHaveValue("daily/note");
    expect(prompt.onOpen).not.toHaveBeenCalled();
  });

  it("drops the failure once the highlight or the input moves off the path", async () => {
    // `projects/k` is a create and ranks a folder, so the list is there to move
    // around in while the failure is on screen.
    createNote.mockRejectedValue(new Error("POST /api/files/projects/k.md failed with 500"));
    const prompt = renderPrompt();

    prompt.type("projects/k");
    prompt.press("Enter");
    await waitFor(() => expect(prompt.hint()).toBe("could not create the note"));

    prompt.press("ArrowDown");
    expect(prompt.hint()).toBe("");

    prompt.press("Tab");
    expect(prompt.hint()).toBe("name the note");
  });

  it("closes on escape", () => {
    const prompt = renderPrompt();

    prompt.press("Escape");

    expect(prompt.onClose).toHaveBeenCalled();
  });

  it("closes on escape wherever the focus sits inside the dialog", () => {
    // A click lands the focus on a row, and the keys have to keep working
    // there or the mouse is the only way back out.
    const prompt = renderPrompt();

    fireEvent.keyDown(prompt.row("projects/"), { key: "Escape" });

    expect(prompt.onClose).toHaveBeenCalled();
  });

  it("hands the focus back to whatever opened it when it closes", () => {
    // The prompt takes the focus to read its own keys, so it owes it back. The
    // opener is the editor for `<leader>n` and the tree for the same key
    // pressed there, and escaping in the tree belongs back in the tree.
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const prompt = renderPrompt();
    expect(prompt.input).toHaveFocus();

    prompt.press("Escape");
    prompt.unmount();

    expect(opener).toHaveFocus();
    opener.remove();
  });

  // A created note and one that was already there both leave with the editor
  // mounting behind the prompt, and it takes the focus only when nobody holds
  // it. Handing the focus back to the opener there makes a note you have to
  // click before you can type in it.
  it.each([["daily/note"], ["index"]])("leaves the focus for the editor on %s", async (typed) => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const prompt = renderPrompt();
    prompt.type(typed);
    prompt.press("Enter");
    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());
    prompt.unmount();

    expect(document.activeElement).toBe(document.body);
    opener.remove();
  });
});
