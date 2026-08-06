import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotePrompt, noteAfterPrompt, type PromptMode } from "@/components/note-prompt";
import { folderCandidates, rankCandidates, rankFolders } from "@/lib/fuzzy";

// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is the path it sends
// and what it does with the answer, not the HTTP.
const { createNote, renameNote, moveFolder } = vi.hoisted(() => ({
  createNote: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ createNote, renameNote, moveFolder }));

// Call counters for the two halves of the ranking. `spy: true` keeps the real
// implementations, so the prompt still ranks for real and the only thing that
// changes is that the calls are recorded. Which half runs how often is
// behaviour here, not an implementation detail: deriving the folder set is the
// larger half and follows the vault, so a keystroke that walks every path again
// is the regression the memo exists to prevent.
vi.mock("@/lib/fuzzy", { spy: true });

// Sorted the way the backend serves it, and holding three folders: `daily/`,
// `projects/` and `projects/kasten/`.
const PATHS = [
  "daily/2026-08-05.md",
  "index.md",
  "projects/kasten.md",
  "projects/kasten/api-design.md",
];

// Twenty-five folders, five more than the list will mount, so the cap has
// something to cut. The `notes-` five sort last of the twenty-five and rank
// first against `no`, because the query opens their name rather than landing
// mid-way through it. So rank-then-cut and cut-then-rank disagree on this
// vault, which is what makes the assertion below able to fail.
const MANY_PATHS = [
  ...Array.from(
    { length: 20 },
    (_, index) => `archive-notes-${String(index).padStart(2, "0")}/entry.md`,
  ),
  ...Array.from({ length: 5 }, (_, index) => `notes-${index}/entry.md`),
];

/** What the input is labelled in each of the three modes. */
const LABEL: Record<PromptMode, string> = {
  create: "new note",
  rename: "rename note",
  folder: "rename folder",
};

function renderPrompt(
  startPath = "",
  vault = PATHS,
  mode: PromptMode = "create",
  openNote?: string,
) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const queryClient = new QueryClient();

  const tree = (paths: string[]) => (
    <QueryClientProvider client={queryClient}>
      <NotePrompt
        mode={mode}
        paths={paths}
        startPath={startPath}
        openNote={openNote}
        onOpen={onOpen}
        onClose={onClose}
      />
    </QueryClientProvider>
  );

  const { rerender, unmount } = render(tree(vault));
  const input = screen.getByLabelText(LABEL[mode]) as HTMLInputElement;

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

  it("lists the folder the typed path names", () => {
    const prompt = renderPrompt();

    prompt.type("daily");

    expect(prompt.rows()).toEqual(["daily/"]);
  });

  it("mounts the twenty best-ranked folders and no more", () => {
    // Ranking the whole vault and showing the head of it, not ranking a head of
    // the vault: the twenty on screen have to be the best twenty of the 25.
    const ranked = rankFolders(MANY_PATHS, "no");
    expect(ranked).toHaveLength(25);

    const prompt = renderPrompt("", MANY_PATHS);
    prompt.type("no");

    // The five best sit last in the vault's own order, so a cap taken before
    // the ranking shows none of them. Written out rather than sliced off
    // `ranked`, so the row that has to be at the top is stated here.
    expect(prompt.rows().slice(0, 5)).toEqual([
      "notes-0/",
      "notes-1/",
      "notes-2/",
      "notes-3/",
      "notes-4/",
    ]);
    expect(prompt.rows()).toEqual(ranked.slice(0, 20));
  });

  it("derives the vault's folders once, however much is typed", () => {
    // The whole of slice 6: the folder set follows the vault, so typing ranks
    // again and derives nothing. Nothing else in the suite can see the
    // difference, because both ways of doing it show the same rows.
    const prompt = renderPrompt("", MANY_PATHS);

    // Derivation already ran once on the mount, which is the one time it should
    // run, so clearing is what makes a zero below reachable.
    vi.mocked(folderCandidates).mockClear();
    vi.mocked(rankCandidates).mockClear();

    const queries = ["n", "no", "not", "note"];
    for (const query of queries) prompt.type(query);

    // Ranking once per keystroke is what proves the keystrokes landed at all,
    // so the zero above it is a fact rather than a prompt that stopped reading
    // its input.
    expect(rankCandidates).toHaveBeenCalledTimes(queries.length);
    expect(folderCandidates).not.toHaveBeenCalled();
  });

  it("keeps the highlight inside the capped list", () => {
    const prompt = renderPrompt("", MANY_PATHS);

    for (let press = 0; press < 25; press += 1) prompt.press("ArrowDown");

    expect(prompt.highlighted()).toBe(rankFolders(MANY_PATHS, "")[19]);
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
