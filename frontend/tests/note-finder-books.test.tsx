import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { NoteFinder } from "@/components/note-finder";

// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is which note it
// asks for and how often, not the HTTP.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

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

  it("lists all of more than twenty books", () => {
    // The note finder mounts twenty rows; a book left past them would be one
    // nobody finds without already knowing its name.
    const notes = Array.from({ length: 25 }, (_, index) => `Books/Book ${index}.md`);
    const finder = renderBooks(
      notes,
      notes.map((note) => note.replace(/\.md$/, ".epub")),
    );

    expect(finder.names()).toHaveLength(25);
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
