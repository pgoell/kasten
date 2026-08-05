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

  render(
    <QueryClientProvider client={queryClient}>
      <NotePrompt paths={PATHS} startPath={startPath} onOpen={onOpen} onClose={onClose} />
    </QueryClientProvider>,
  );

  const input = screen.getByLabelText("new note") as HTMLInputElement;

  return {
    input,
    onOpen,
    onClose,
    queryClient,
    type: (value: string) => fireEvent.change(input, { target: { value } }),
    press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
    rows: () => screen.getAllByRole("option").map((row) => row.textContent),
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
    const prompt = renderPrompt();
    const invalidate = vi.spyOn(prompt.queryClient, "invalidateQueries");

    prompt.type("daily/note");
    prompt.press("Enter");

    await waitFor(() => expect(prompt.onOpen).toHaveBeenCalled());
    expect(prompt.queryClient.getQueryData(["note", "daily/note.md"])).toBe("");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["files"] });
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

  it("closes on escape", () => {
    const prompt = renderPrompt();

    prompt.press("Escape");

    expect(prompt.onClose).toHaveBeenCalled();
  });
});
