import { waitFor } from "@testing-library/react";
import { PATHS, renderPrompt } from "./note-prompt-fixture";

const { createNote, renameNote, moveFolder } = vi.hoisted(() => ({
  createNote: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ createNote }));
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));

describe("the rename folder prompt", () => {
  beforeEach(() => {
    moveFolder.mockResolvedValue({ path: "reading" });
  });

  afterEach(() => {
    moveFolder.mockReset();
  });

  /** The prompt opened on `projects/`, which holds two of the four PATHS. */
  function renderFolder(startPath = "projects", openNote?: string) {
    return renderPrompt(startPath, PATHS, "folder", openNote);
  }

  it("opens on the folder's own path with the whole name selected", () => {
    const prompt = renderFolder("projects/kasten");

    expect(prompt.input).toHaveValue("projects/kasten");
    // The whole last segment, because a folder has a name and not a name and a
    // suffix. `2026.05` is one name, not `2026` with `.05` after it.
    expect(prompt.input.selectionStart).toBe("projects/".length);
    expect(prompt.input.selectionEnd).toBe("projects/kasten".length);
  });

  it("says how many notes the move carries", () => {
    const prompt = renderFolder();

    prompt.type("reading");

    expect(prompt.hint()).toBe("moves 2 notes");
  });

  it("counts one note as one", () => {
    const prompt = renderFolder("daily");

    prompt.type("journal");

    expect(prompt.hint()).toBe("moves 1 note");
  });

  it("leaves the folder and its own subtree out of the list", () => {
    // Neither is a place the folder can go, and the vault refuses both, so
    // completing to one would only be a way to type a refusal faster. The vault
    // has `daily/`, `projects/` and `projects/kasten/`, and an empty query
    // matches every one of them.
    const prompt = renderFolder();

    prompt.type("");

    expect(prompt.rows()).toEqual(["daily/"]);
  });

  it("adds no .md to what was typed", async () => {
    const prompt = renderFolder();

    prompt.type("reading");
    prompt.press("Enter");

    await waitFor(() => expect(moveFolder).toHaveBeenCalledWith("projects", "reading"));
  });

  it("refuses a folder the vault already has", () => {
    const prompt = renderFolder();

    prompt.type("daily");
    prompt.press("Enter");

    expect(prompt.hint()).toBe("a folder is already there");
    expect(moveFolder).not.toHaveBeenCalled();
    expect(prompt.onOpen).not.toHaveBeenCalled();
  });

  it("refuses a move inside the folder itself", () => {
    const prompt = renderFolder();

    prompt.type("projects/archive");
    prompt.press("Enter");

    expect(prompt.hint()).toBe("a folder cannot move inside itself");
    expect(moveFolder).not.toHaveBeenCalled();
  });

  it("closes without a request when the path is left alone", () => {
    const prompt = renderFolder();

    prompt.press("Enter");

    expect(moveFolder).not.toHaveBeenCalled();
    expect(prompt.onClose).toHaveBeenCalled();
  });

  it("reports the path the vault gave back, not the one that was typed", async () => {
    // The vault answers with its own spelling, and that is what the route
    // rewrites `?note=` against.
    moveFolder.mockResolvedValue({ path: "archive/canonical" });
    const prompt = renderFolder();

    prompt.type("archive/typed");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalledWith("archive/canonical"));
  });

  it("drops every cached note that moved and keeps the rest", async () => {
    const prompt = renderFolder();
    prompt.queryClient.setQueryData(["note", "projects/kasten.md"], "# kasten");
    prompt.queryClient.setQueryData(["note", "projects/kasten/api-design.md"], "# api");
    prompt.queryClient.setQueryData(["note", "index.md"], "# index");

    prompt.type("reading");
    prompt.press("Enter");
    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());

    // The notes are at new paths now, and the vault is the only thing that
    // knows what is in them, so the copies under the old paths go rather than
    // move: a note edited outside kasten must not arrive stale on the far side.
    expect(prompt.queryClient.getQueryData(["note", "projects/kasten.md"])).toBeUndefined();
    expect(
      prompt.queryClient.getQueryData(["note", "projects/kasten/api-design.md"]),
    ).toBeUndefined();
    expect(prompt.queryClient.getQueryData(["note", "index.md"])).toBe("# index");
  });

  it("stays open with the typed path when the vault refused the move", async () => {
    moveFolder.mockRejectedValue(new Error("PATCH failed with 409"));
    const prompt = renderFolder();

    prompt.type("reading");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.hint()).toBe("could not rename the folder"));
    expect(prompt.input).toHaveValue("reading");
    expect(prompt.onOpen).not.toHaveBeenCalled();
  });

  it("sends the one request when Enter is held", async () => {
    const prompt = renderFolder();

    prompt.type("reading");
    prompt.press("Enter");
    prompt.press("Enter");
    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());

    expect(moveFolder).toHaveBeenCalledTimes(1);
  });

  it("hands the focus back to the tree when the editor is not following", async () => {
    // The editor takes the focus only when it is about to show another note.
    // A folder renamed from the tree with nothing of it open leaves the next
    // key belonging to the tree, so the row that opened the prompt gets it.
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const prompt = renderFolder("projects", "index.md");
    prompt.type("reading");
    prompt.press("Enter");
    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());
    prompt.unmount();

    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("leaves the focus for the editor when the open note moved with the folder", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const prompt = renderFolder("projects", "projects/kasten.md");
    prompt.type("reading");
    prompt.press("Enter");
    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());
    prompt.unmount();

    expect(document.activeElement).toBe(document.body);
    opener.remove();
  });
});
