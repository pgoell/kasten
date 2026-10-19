import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NoteFinder } from "@/components/note-finder";
import { NARROW, stubMatchMedia } from "./match-media";

// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is which note it
// asks for and how often, not the HTTP.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

// Sorted the way the backend serves it.
const PATHS = [
  "daily/2026-08-05.md",
  "index.md",
  "projects/kasten.md",
  "projects/kasten/api-design.md",
];

// Twenty-five notes, five more than the list will mount, so the cap has
// something to cut. The `notes-` five sort last of the twenty-five and rank
// first against `no`, because the query opens their name rather than landing
// mid-way through it. So rank-then-cut and cut-then-rank disagree on this
// vault, which is what makes the assertion below able to fail.
const MANY_PATHS = [
  ...Array.from(
    { length: 20 },
    (_, index) => `archive-notes-${String(index).padStart(2, "0")}/entry.md`,
  ),
  ...Array.from({ length: 5 }, (_, index) => `notes-${index}.md`),
];

function renderFinder(vault = PATHS, queryClient = new QueryClient()) {
  const onOpen = vi.fn();
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <NoteFinder paths={vault} onOpen={onOpen} onClose={onClose} />
    </QueryClientProvider>,
  );

  const input = screen.getByLabelText("find note") as HTMLInputElement;

  return {
    input,
    onOpen,
    onClose,
    queryClient,
    preview: () => screen.getByTestId("preview").textContent,
    type: (value: string) => fireEvent.change(input, { target: { value } }),
    // `fireEvent` returns false when a handler called `preventDefault`, which
    // is how a test pins that the browser's own answer to the key never ran.
    press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
    rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
    highlighted: () => screen.queryByRole("option", { selected: true })?.textContent,
    hint: () => screen.getByRole("status").textContent,
  };
}

describe("the note finder", () => {
  beforeEach(() => {
    fetchNote.mockResolvedValue("# a note");
  });

  afterEach(() => {
    fetchNote.mockReset();
  });

  it("opens the row that is tapped", () => {
    const finder = renderFinder();

    const row = screen.getByRole("option", { name: "index.md" });
    fireEvent.click(row);

    expect(finder.onOpen).toHaveBeenCalledWith("index.md");
    // jsdom applies no media query, so the height is read off the class.
    expect(row).toHaveClass("pointer-coarse:min-h-11");
  });

  it("gives the list the whole panel below md", () => {
    renderFinder();

    expect(screen.getByRole("listbox")).toHaveClass("w-full", "md:w-1/2");
  });

  it("reads and draws no preview in a narrow window", async () => {
    stubMatchMedia({ [NARROW]: true });
    const finder = renderFinder();
    expect(finder.highlighted()).toBe(PATHS[0]);

    // Past the delay the pane waits before it reads.
    await new Promise((done) => setTimeout(done, 300));

    expect(screen.queryByTestId("preview")).toBeNull();
    expect(fetchNote).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("opens on the whole vault, with the caret in the input", () => {
    const finder = renderFinder();

    expect(finder.input).toHaveValue("");
    expect(finder.input).toHaveFocus();
    expect(finder.rows()).toEqual(PATHS);
  });

  it("mounts the twenty best-ranked notes and no more", () => {
    // Ranking the whole vault and showing the head of it, not ranking a head of
    // the vault. The five whose name opens on the query outrank the twenty that
    // only carry the letters, so they are what the cap must leave standing.
    const finder = renderFinder(MANY_PATHS);

    finder.type("no");

    const rows = finder.rows();
    expect(rows).toHaveLength(20);
    expect(rows.slice(0, 5)).toEqual([
      "notes-0.md",
      "notes-1.md",
      "notes-2.md",
      "notes-3.md",
      "notes-4.md",
    ]);
  });

  it("narrows to the notes the query reads into", () => {
    const finder = renderFinder();

    finder.type("api");

    expect(finder.rows()).toEqual(["projects/kasten/api-design.md"]);
  });

  it("moves the highlight down with the arrow and with ctrl n", () => {
    const finder = renderFinder();

    expect(finder.highlighted()).toBe(PATHS[0]);
    finder.press("ArrowDown");
    expect(finder.highlighted()).toBe(PATHS[1]);
    finder.press("n", { ctrlKey: true });
    expect(finder.highlighted()).toBe(PATHS[2]);
  });

  it("moves the highlight down with ctrl j and back up with ctrl k", () => {
    const finder = renderFinder();

    finder.press("j", { ctrlKey: true });
    expect.soft(finder.highlighted()).toBe(PATHS[1]);
    finder.press("k", { ctrlKey: true });
    finder.press("k", { ctrlKey: true });
    finder.press("j", { ctrlKey: true });
    expect(finder.highlighted()).toBe(PATHS[1]);
  });

  it("moves the highlight up with the arrow and with ctrl p", () => {
    const finder = renderFinder();

    finder.press("ArrowDown");
    finder.press("ArrowDown");
    expect(finder.highlighted()).toBe(PATHS[2]);
    finder.press("ArrowUp");
    expect(finder.highlighted()).toBe(PATHS[1]);
    finder.press("p", { ctrlKey: true });
    expect(finder.highlighted()).toBe(PATHS[0]);
  });

  it("opens the highlighted note, not the text that was typed", () => {
    // The whole contract of the finder against the prompt's. `kap` names no
    // path at all; the row it ranks first does.
    const finder = renderFinder();

    finder.type("kap");
    finder.press("Enter");

    expect(finder.onOpen).toHaveBeenCalledWith("projects/kasten/api-design.md");
  });

  it("opens the row the highlight was moved to", () => {
    const finder = renderFinder();

    finder.press("ArrowDown");
    finder.press("Enter");

    expect(finder.onOpen).toHaveBeenCalledWith(PATHS[1]);
  });

  it("closes on escape without opening anything", () => {
    const finder = renderFinder();

    finder.press("Escape");

    expect(finder.onClose).toHaveBeenCalledTimes(1);
    expect(finder.onOpen).not.toHaveBeenCalled();
  });

  it("says so when the query reads into nothing, and opens nothing on enter", () => {
    const finder = renderFinder();

    finder.type("zzz");

    expect(finder.rows()).toEqual([]);
    expect(finder.hint()).toBe("no notes match");

    finder.press("Enter");

    expect(finder.onOpen).not.toHaveBeenCalled();
  });

  it("says the vault is empty when it holds no notes", () => {
    const finder = renderFinder([]);

    expect(finder.rows()).toEqual([]);
    expect(finder.hint()).toBe("the vault has no notes");
  });

  it("puts the highlight back on the first row when the query changes", () => {
    const finder = renderFinder();

    finder.press("ArrowDown");
    finder.type("k");

    expect(finder.highlighted()).toBe("projects/kasten.md");
  });

  it("walks the list on tab rather than letting the focus leave", () => {
    const finder = renderFinder();

    expect(finder.press("Tab")).toBe(false);

    expect(finder.highlighted()).toBe("index.md");
  });

  it("walks back up on shift tab", () => {
    const finder = renderFinder();

    finder.press("Tab");
    finder.press("Tab", { shiftKey: true });

    expect(finder.highlighted()).toBe("daily/2026-08-05.md");
  });

  it("holds the focus on tab even with nothing to walk", () => {
    // An empty list is the one place Tab would leave the panel and not come
    // back, so the key is answered before the list is looked at.
    const finder = renderFinder([]);

    expect(finder.press("Tab")).toBe(false);
  });
});

describe("the outgoing links panel", () => {
  beforeEach(() => {
    fetchNote.mockResolvedValue("# a note");
  });

  afterEach(() => {
    fetchNote.mockReset();
  });

  function renderLinksOut(links: string[]) {
    const onOpen = vi.fn();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <NoteFinder paths={links} outgoing onOpen={onOpen} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText("links out") as HTMLInputElement;

    return {
      onOpen,
      type: (value: string) => fireEvent.change(input, { target: { value } }),
      press: (key: string) => fireEvent.keyDown(input, { key }),
      rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
      hint: () => screen.getByRole("status").textContent,
    };
  }

  it("lists the notes it was handed rather than the vault", () => {
    const panel = renderLinksOut(["index.md", "projects/kasten.md"]);

    expect(panel.rows()).toEqual(["index.md", "projects/kasten.md"]);
  });

  it("narrows and opens the way the finder does", () => {
    const panel = renderLinksOut(["index.md", "projects/kasten.md"]);

    panel.type("kas");
    panel.press("Enter");

    expect(panel.onOpen).toHaveBeenCalledWith("projects/kasten.md");
  });

  it("says the note links nowhere rather than that the vault is empty", () => {
    // Two emptinesses, and saying the wrong one about a full vault is the whole
    // reason the panel is told which list it is holding.
    const panel = renderLinksOut([]);

    expect(panel.hint()).toBe("this note links nowhere");
  });
});

describe("the note finder's preview", () => {
  beforeEach(() => {
    fetchNote.mockResolvedValue("# a note");
  });

  afterEach(() => {
    fetchNote.mockReset();
  });

  it("shows the text of the note under the highlight", async () => {
    const finder = renderFinder();

    // Rendered, so the heading's `#` is hidden the way the editor hides it.
    await waitFor(() => expect(finder.preview()).toBe("a note"));
    expect(fetchNote).toHaveBeenCalledWith(PATHS[0]);
  });

  it("renders the markdown rather than showing its syntax", async () => {
    // The same rendering the editor does, so the pane shows the note the way
    // opening it will. Anything else makes the preview a different document
    // from the one behind it.
    fetchNote.mockResolvedValue("# a note\n\nwith **bold** in it");
    const finder = renderFinder();

    await waitFor(() => expect(finder.preview()).toContain("with bold in it"));
    expect(finder.preview()).not.toContain("#");
    expect(finder.preview()).not.toContain("**");
    expect(document.querySelector(".cm-strong")?.textContent).toBe("bold");
  });

  it("asks for one note when the highlight is walked and brought back", async () => {
    // Holding ctrl+n walks a row per repeat. Without the delay every row it
    // passed through would be a request, and the only answer that matters is
    // the one it stopped on.
    const finder = renderFinder();

    finder.press("ArrowDown");
    finder.press("ArrowDown");
    finder.press("ArrowUp");
    finder.press("ArrowUp");

    await waitFor(() => expect(finder.preview()).toBe("a note"));
    expect(fetchNote).toHaveBeenCalledTimes(1);
    expect(fetchNote).toHaveBeenCalledWith(PATHS[0]);
  });

  it("reads a note the cache already holds without asking for it", async () => {
    // The key is the one NoteEditor reads, so a note that is open is already
    // here, and the preview of it costs nothing.
    const queryClient = new QueryClient();
    queryClient.setQueryData(["note", PATHS[0]], "# already open");

    const finder = renderFinder(PATHS, queryClient);

    await waitFor(() => expect(finder.preview()).toBe("already open"));
    expect(fetchNote).not.toHaveBeenCalled();
  });

  it("says so when the note cannot be read, and still opens it on enter", async () => {
    fetchNote.mockRejectedValue(new Error("GET /api/files/x failed with 500"));
    const finder = renderFinder();

    await waitFor(() => expect(finder.preview()).toBe("could not read this note"));
    // The list is what the finder is for, and a preview that failed is no
    // reason to stop being able to open the row.
    expect(finder.rows()).toEqual(PATHS);

    finder.press("Enter");

    expect(finder.onOpen).toHaveBeenCalledWith(PATHS[0]);
  });

  it("shows an empty pane for an empty note rather than waiting forever", async () => {
    fetchNote.mockResolvedValue("");
    const finder = renderFinder();

    await waitFor(() => expect(fetchNote).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(finder.preview()).toBe(""));
  });

  it("shows no pane at all when nothing is highlighted", () => {
    const finder = renderFinder();

    finder.type("zzz");

    expect(screen.queryByTestId("preview")).toBeNull();
    expect(fetchNote).not.toHaveBeenCalled();
  });
});

describe("the book finder", () => {
  // Three books, and a note for each way of not being one: a pdf beside it, an
  // epub spelt in capitals, nothing beside it at all. `Orphan.epub` is a book
  // with no note, and `Root` sits at the vault's root, which has no folder.
  const NOTES = [
    "Books/DDIA.md",
    "Books/Sub/Refactoring.md",
    "Paper.md",
    "Plan.md",
    "Root.md",
    "index.md",
  ];
  const ASSETS = [
    "Books/DDIA.epub",
    "Books/Sub/Refactoring.epub",
    "Orphan.epub",
    "Paper.pdf",
    "Plan.EPUB",
    "Root.epub",
    "cover.png",
  ];

  beforeEach(() => {
    fetchNote.mockResolvedValue("# a note");
  });

  afterEach(() => {
    fetchNote.mockReset();
  });

  function renderBooks(notes = NOTES, assets = ASSETS) {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <NoteFinder paths={notes} books={assets} onOpen={onOpen} onClose={onClose} />
      </QueryClientProvider>,
    );

    // By role rather than by its label, so a finder that ignores `books` and
    // still calls itself "find note" fails on what it lists, not on a lookup.
    const input = screen.getByRole("combobox");
    // A row's first part is the book's name. A row without parts is a bare
    // path, and is read as one.
    const name = (row: HTMLElement) => row.firstElementChild?.textContent ?? row.textContent;

    return {
      input,
      onOpen,
      onClose,
      unmount,
      type: (value: string) => fireEvent.change(input, { target: { value } }),
      press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
      names: () => screen.queryAllByRole("option").map(name),
      rows: () =>
        screen
          .queryAllByRole("option")
          .map((row) => Array.from(row.children, (part) => part.textContent)),
      highlighted: () => {
        const row = screen.queryByRole("option", { selected: true });
        return row === null ? undefined : name(row);
      },
      hint: () => screen.queryByRole("status")?.textContent,
      dialog: () => screen.queryByRole("dialog", { name: "Find book" }),
    };
  }

  it("lists every note with an epub beside it, and leaves a pdf's note out", () => {
    const finder = renderBooks();

    expect(finder.names()).toEqual(["DDIA", "Refactoring", "Root"]);
  });

  it("takes Plan.EPUB for no book of Plan.md, and an epub with no note for none", () => {
    // The pairing `resolve_book` makes: the note's path with `.epub` for `.md`,
    // spelt exactly so.
    const finder = renderBooks(["Plan.md"], ["Plan.EPUB", "Orphan.epub"]);

    expect.soft(finder.names()).toEqual([]);
    expect(finder.hint()).toBe("the vault has no books");
  });

  it("shows each book's name with its folder beside it", () => {
    const finder = renderBooks();

    expect(finder.rows()).toEqual([
      ["DDIA", "Books"],
      ["Refactoring", "Books/Sub"],
      ["Root", ""],
    ]);
  });

  it("narrows to the books the query reads into", () => {
    const finder = renderBooks();

    finder.type("refac");

    expect(finder.names()).toEqual(["Refactoring"]);
  });

  it("moves the highlight down with ctrl j and up with ctrl k", () => {
    const finder = renderBooks();

    finder.press("j", { ctrlKey: true });
    expect.soft(finder.highlighted()).toBe("Refactoring");
    finder.press("k", { ctrlKey: true });
    expect(finder.highlighted()).toBe("DDIA");
  });

  it("moves the highlight with the arrows", () => {
    const finder = renderBooks();

    finder.press("ArrowDown");
    expect.soft(finder.highlighted()).toBe("Refactoring");
    finder.press("ArrowUp");
    expect(finder.highlighted()).toBe("DDIA");
  });

  it("leaves a bare j or k to the filter", () => {
    const finder = renderBooks();

    expect.soft(finder.dialog()).toBeInTheDocument();
    // `fireEvent` answers true when nobody called `preventDefault`, so the
    // letter reaches the input.
    expect.soft(finder.press("j")).toBe(true);
    expect.soft(finder.press("k")).toBe(true);
    expect(finder.highlighted()).toBe("DDIA");
  });

  it("closes on escape without opening anything", () => {
    const finder = renderBooks();

    expect.soft(finder.dialog()).toBeInTheDocument();
    finder.press("Escape");

    expect.soft(finder.onClose).toHaveBeenCalledTimes(1);
    expect(finder.onOpen).not.toHaveBeenCalled();
  });

  it("says the vault has no books when no note has an epub beside it", () => {
    const finder = renderBooks(NOTES, ["Paper.pdf", "cover.png"]);

    expect.soft(finder.names()).toEqual([]);
    expect(finder.hint()).toBe("the vault has no books");
  });

  it("says no books match, and opens nothing on enter", () => {
    const finder = renderBooks();

    finder.type("zzz");
    expect.soft(finder.hint()).toBe("no books match");
    finder.press("Enter");

    expect(finder.onOpen).not.toHaveBeenCalled();
  });

  it("puts the highlight back on the first row when the query changes", () => {
    // `r` reads into Refactoring and Root alike, so a highlight left on the
    // second row would land on Root.
    const finder = renderBooks();

    expect.soft(finder.dialog()).toBeInTheDocument();
    finder.press("ArrowDown");
    finder.type("r");

    expect(finder.highlighted()).toBe("Refactoring");
  });

  it("stops the highlight at both ends", () => {
    const finder = renderBooks();

    expect.soft(finder.dialog()).toBeInTheDocument();
    finder.press("ArrowUp");
    expect.soft(finder.highlighted()).toBe("DDIA");
    for (let step = 0; step < 5; step += 1) finder.press("ArrowDown");

    expect(finder.highlighted()).toBe("Root");
  });

  it("gives the focus back to what held it on escape", () => {
    render(<button type="button">opener</button>);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    const finder = renderBooks();

    expect.soft(finder.dialog()).toBeInTheDocument();
    expect.soft(finder.input).toHaveFocus();
    finder.press("Escape");
    // The caller unmounts the finder on close, which is where the focus goes
    // back.
    finder.unmount();

    expect(opener).toHaveFocus();
  });

  it("closes on a tap on the backdrop", () => {
    const finder = renderBooks();

    expect.soft(finder.dialog()).toBeInTheDocument();
    const sheet = screen.getByRole("dialog");
    fireEvent.mouseDown(sheet);
    fireEvent.mouseUp(sheet);
    fireEvent.click(sheet);

    expect(finder.onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the note of the book that is tapped", () => {
    // The note's path, which is what the book pane takes.
    const finder = renderBooks();

    expect.soft(finder.dialog()).toBeInTheDocument();
    const row = screen.queryAllByRole("option")[2];
    if (row !== undefined) fireEvent.click(row);

    expect(finder.onOpen).toHaveBeenCalledWith("Root.md");
  });

  it("reads and draws no preview", async () => {
    renderBooks();

    // Past the delay the note finder waits before it reads.
    await new Promise((done) => setTimeout(done, 300));

    expect.soft(screen.queryByTestId("preview")).toBeNull();
    expect(fetchNote).not.toHaveBeenCalled();
  });
});
