import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotePrompt } from "@/components/note-prompt";

// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is the path it sends
// and what it does with the answer, not the HTTP.
const { createNote } = vi.hoisted(() => ({ createNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ createNote }));

// Sorted the way the backend serves it, and holding three folders: `daily/`,
// `projects/` and `projects/kasten/`.
const PATHS = [
  "daily/2026-08-05.md",
  "index.md",
  "projects/kasten.md",
  "projects/kasten/api-design.md",
];

function renderPrompt(startPath = "") {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const queryClient = new QueryClient();

  const tree = (paths: string[]) => (
    <QueryClientProvider client={queryClient}>
      <NotePrompt paths={paths} startPath={startPath} onOpen={onOpen} onClose={onClose} />
    </QueryClientProvider>
  );

  const { rerender, unmount } = render(tree(PATHS));
  const input = screen.getByLabelText("new note") as HTMLInputElement;

  return {
    input,
    onOpen,
    onClose,
    queryClient,
    unmount,
    type: (value: string) => fireEvent.change(input, { target: { value } }),
    // `fireEvent` returns false when a handler called `preventDefault`, which
    // is how a test pins that the browser's own answer to the key never ran.
    press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
    /** A fresh listing from the tree, which the prompt takes as a prop. */
    setPaths: (paths: string[]) => rerender(tree(paths)),
    row: (folder: string) => screen.getByText(folder),
    rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
    highlighted: () => screen.getByRole("option", { selected: true }).textContent,
    hint: () => screen.getByRole("status").textContent,
  };
}

describe("the new note prompt", () => {
  beforeEach(() => {
    createNote.mockResolvedValue("daily/note.md");
  });

  afterEach(() => {
    createNote.mockReset();
  });

  it("opens on the folder it was given, with the caret in the input", () => {
    const prompt = renderPrompt("daily/");

    expect(prompt.input).toHaveValue("daily/");
    expect(prompt.input).toHaveFocus();
  });

  it("lists the folder the typed path names", () => {
    const prompt = renderPrompt();

    prompt.type("daily");

    expect(prompt.rows()).toEqual(["daily/"]);
  });

  it("folds the highlighted folder into the input on tab", () => {
    const prompt = renderPrompt();

    prompt.type("pk");
    prompt.press("Tab");

    expect(prompt.input).toHaveValue("projects/kasten/");
  });

  it("folds the folder a click landed on into the input", () => {
    const prompt = renderPrompt();

    // jsdom moves no focus on a click, so drop it first to watch the input
    // take it back. In a browser the row is what takes it away.
    prompt.input.blur();
    fireEvent.click(prompt.row("projects/"));

    // The clicked row, not the highlighted one, which is still `daily/`.
    expect(prompt.input).toHaveValue("projects/");
    expect(prompt.input).toHaveFocus();
  });

  it("holds the focus on tab when the list has nothing to fold in", () => {
    const prompt = renderPrompt();

    prompt.type("zzqq/x");
    expect(prompt.rows()).toEqual([]);

    // The browser's own tab would take the focus out of the dialog, and the
    // keys that close it go with it.
    expect(prompt.press("Tab")).toBe(false);
  });

  it("moves the highlight down and up on the arrows", () => {
    const prompt = renderPrompt();

    expect(prompt.highlighted()).toBe("daily/");

    prompt.press("ArrowDown");
    expect(prompt.highlighted()).toBe("projects/");

    prompt.press("ArrowUp");
    expect(prompt.highlighted()).toBe("daily/");
  });

  it("moves the highlight on ctrl+n and ctrl+p too", () => {
    const prompt = renderPrompt();

    prompt.press("n", { ctrlKey: true });
    expect(prompt.highlighted()).toBe("projects/");

    prompt.press("p", { ctrlKey: true });
    expect(prompt.highlighted()).toBe("daily/");
  });

  it("stops the highlight at the ends of the list", () => {
    const prompt = renderPrompt();

    prompt.press("ArrowUp");
    expect(prompt.highlighted()).toBe("daily/");

    prompt.press("ArrowDown");
    prompt.press("ArrowDown");
    prompt.press("ArrowDown");
    expect(prompt.highlighted()).toBe("projects/kasten/");
  });

  it("keeps the arrows off the caret", () => {
    // Left to the browser they take the caret to one end of the input instead.
    const prompt = renderPrompt();

    expect(prompt.press("ArrowDown")).toBe(false);
    expect(prompt.press("ArrowUp")).toBe(false);
  });

  it("keeps the highlight in the list when a fresh listing shortens it", () => {
    // Typing cannot strand the highlight, because it puts it back on the first
    // row. A listing arriving from the tree can.
    const prompt = renderPrompt();

    prompt.press("ArrowDown");
    prompt.press("ArrowDown");
    expect(prompt.highlighted()).toBe("projects/kasten/");

    prompt.setPaths(["daily/2026-08-05.md"]);

    expect(prompt.highlighted()).toBe("daily/");
  });

  it("leaves the highlight where it is when a fresh listing lengthens it", () => {
    const prompt = renderPrompt();

    prompt.press("ArrowDown");
    prompt.press("ArrowDown");
    prompt.press("ArrowDown");

    prompt.setPaths([...PATHS, "reading/borges.md"]);

    // The fourth row is one the highlight never walked to.
    expect(prompt.highlighted()).toBe("projects/kasten/");
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
    createNote.mockResolvedValue("daily/canonical.md");
    const prompt = renderPrompt();

    prompt.type("daily/note");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalledWith("daily/canonical.md"));
  });

  it("seeds the new note's text and asks the tree for a fresh listing", async () => {
    // The canonical spelling again, so that seeding the typed path reads as
    // what it is rather than as seeding the right one.
    createNote.mockResolvedValue("daily/canonical.md");
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
