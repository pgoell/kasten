import { waitFor } from "@testing-library/react";
import { PATHS, renderPrompt } from "./note-prompt-fixture";

const { createNote, renameNote, moveFolder } = vi.hoisted(() => ({
  createNote: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ createNote }));
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));

describe("the rename prompt", () => {
  beforeEach(() => {
    renameNote.mockResolvedValue({ path: "reading/borges.md", content: "# borges" });
  });

  afterEach(() => {
    renameNote.mockReset();
  });

  /** The prompt opened on a note that is in PATHS, which is what a rename does. */
  function renderRename(startPath = "projects/kasten.md") {
    return renderPrompt(startPath, PATHS, "rename");
  }

  it("opens on the note's own path with the name selected", () => {
    const prompt = renderRename();

    expect(prompt.input).toHaveValue("projects/kasten.md");
    expect(prompt.input).toHaveFocus();
    // The folder and the suffix are the parts a rename usually keeps, so the
    // selection covers the stem and typing replaces exactly that.
    expect(prompt.input.selectionStart).toBe("projects/".length);
    expect(prompt.input.selectionEnd).toBe("projects/kasten".length);
  });

  it("refuses a path that already holds another note", () => {
    const prompt = renderRename();

    prompt.type("index.md");
    prompt.press("Enter");

    expect(prompt.hint()).toBe("a note is already there");
    expect(renameNote).not.toHaveBeenCalled();
    expect(prompt.onOpen).not.toHaveBeenCalled();
  });

  it("closes without a request when the path is left alone", () => {
    // The prefill is the note's own path, so the first Enter would otherwise
    // bounce off the vault as a collision with itself.
    const prompt = renderRename();

    prompt.press("Enter");

    expect(renameNote).not.toHaveBeenCalled();
    expect(prompt.onClose).toHaveBeenCalled();
  });

  it("moves the note, suffix and all", async () => {
    const prompt = renderRename();

    prompt.type("reading/borges");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());
    // The old path from the prefill, the new one with `.md` put back on.
    expect(renameNote).toHaveBeenCalledWith("projects/kasten.md", "reading/borges.md");
  });

  it("opens the path the vault gave back, not the one that was typed", async () => {
    // The vault answers with the canonical spelling, and that is what `?note=`
    // has to carry or the tree marks nothing.
    renameNote.mockResolvedValue({ path: "reading/canonical.md", content: "# borges" });
    const prompt = renderRename();

    prompt.type("reading/borges");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalledWith("reading/canonical.md"));
  });

  it("carries the note's text to the new path and drops the old one", async () => {
    const prompt = renderRename();
    prompt.queryClient.setQueryData(["note", "projects/kasten.md"], "# borges");

    prompt.type("reading/borges");
    prompt.press("Enter");
    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());

    // From the response rather than the old key, so a note edited outside
    // kasten does not arrive stale on the other side of the move.
    expect(prompt.queryClient.getQueryData(["note", "reading/borges.md"])).toBe("# borges");
    expect(prompt.queryClient.getQueryData(["note", "projects/kasten.md"])).toBeUndefined();
  });

  it("sends the one request when Enter is held", async () => {
    const prompt = renderRename();

    prompt.type("reading/borges");
    prompt.press("Enter");
    prompt.press("Enter");
    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());

    expect(renameNote).toHaveBeenCalledTimes(1);
  });

  it("stays open with the typed path when the vault refused the move", async () => {
    renameNote.mockRejectedValue(new Error("PATCH failed with 409"));
    const prompt = renderRename();

    prompt.type("reading/borges");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.hint()).toBe("could not rename the note"));
    expect(prompt.input).toHaveValue("reading/borges");
    expect(prompt.onOpen).not.toHaveBeenCalled();
    expect(prompt.onClose).not.toHaveBeenCalled();
  });

  it("tries again after a refusal", async () => {
    renameNote.mockRejectedValueOnce(new Error("PATCH failed with 409"));
    const prompt = renderRename();

    prompt.type("reading/borges");
    prompt.press("Enter");
    await waitFor(() => expect(prompt.hint()).toBe("could not rename the note"));

    prompt.press("Enter");

    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());
    expect(renameNote).toHaveBeenCalledTimes(2);
  });

  it("still ranks the vault's folders", () => {
    // The whole point of reusing the prompt: a rename moves between folders,
    // so it needs the completion a create has.
    const prompt = renderRename();

    prompt.type("proj");

    expect(prompt.rows()).toEqual(["projects/", "projects/kasten/"]);
  });
});
