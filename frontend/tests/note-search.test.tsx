import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NoteSearch } from "@/components/note-search";

// Standing in for the module rather than for `fetch`, the way the finder's
// tests do: what this component owns is what it asks the vault for and how
// often, not the HTTP underneath.
const { searchNotes, fetchNote, fetchTodos } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos }));

const HITS = [
  { path: "projects/kasten.md", line: 12, text: "Postgres holds a derived index." },
  { path: "reference/deploy.md", line: 88, text: "postgres runs in its own container" },
];

function renderSearch() {
  const onOpen = vi.fn();
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <NoteSearch onOpen={onOpen} onClose={onClose} />
    </QueryClientProvider>,
  );

  const input = screen.getByLabelText("search notes") as HTMLInputElement;

  return {
    input,
    onOpen,
    onClose,
    type: (value: string) => fireEvent.change(input, { target: { value } }),
    press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
    rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
    hint: () => screen.getByRole("status").textContent,
    preview: () => screen.queryByTestId("preview")?.textContent ?? "",
    lineNumbers: () =>
      [...document.querySelectorAll(".cm-gutterElement")].map((n) => n.textContent ?? ""),
    markedLine: () => document.querySelector(".cm-searchHit")?.textContent ?? "",
  };
}

beforeEach(() => {
  searchNotes.mockReset();
  fetchNote.mockReset();
  fetchTodos.mockReset();
  searchNotes.mockResolvedValue(HITS);
  fetchNote.mockResolvedValue(NOTE);
  fetchTodos.mockResolvedValue([]);
});

/** A note long enough that a window around a hit has to leave some of it out. */
const NOTE = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");

it("asks the vault for what was typed", async () => {
  const search = renderSearch();

  search.type("postgres");

  await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("postgres", false));
});

it("asks nothing of the vault until the typing settles", async () => {
  const search = renderSearch();

  search.type("p");
  search.type("po");
  search.type("pos");

  // One query for the word, not one per letter. Every keystroke firing its own
  // scan is the thing the delay exists to stop.
  await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("pos", false));
  expect(searchNotes).toHaveBeenCalledTimes(1);
});

it("shows the note, the line number and the line", async () => {
  const search = renderSearch();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(2));
  expect(search.rows()[0]).toContain("projects/kasten.md");
  expect(search.rows()[0]).toContain("12");
  expect(search.rows()[0]).toContain("Postgres holds a derived index.");
});

it("opens the note on the line the match is on", async () => {
  const search = renderSearch();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  search.press("Enter");

  expect(search.onOpen).toHaveBeenCalledWith("projects/kasten.md", 12);
});

it("ranks the lines it was handed rather than showing them in the order they came", async () => {
  // rg answers in path order, so `kasten.md` arrives first. Against `runs`
  // only the second line reads well, and the ranking is what has to say so.
  const search = renderSearch();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));

  searchNotes.mockResolvedValue(HITS);
  search.type("runs");

  await waitFor(() => expect(search.rows()[0]).toContain("reference/deploy.md"));
});

it("narrows what it already has while the next answer is on its way", async () => {
  // The whole point of ranking on this side. The vault answered for `postgres`
  // and the letters that follow filter that answer in the browser, so typing
  // keeps narrowing rather than freezing until the next scan lands.
  const search = renderSearch();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));

  searchNotes.mockReturnValue(new Promise(() => {}));
  search.type("postgres container");

  await waitFor(() => expect(search.rows()).toHaveLength(1));
  expect(search.rows()[0]).toContain("reference/deploy.md");
});

it("says so when the vault holds nothing that matches", async () => {
  searchNotes.mockResolvedValue([]);
  const search = renderSearch();

  search.type("wikilink");

  await waitFor(() => expect(search.hint()).toBe("no notes match"));
});

it("closes on escape without opening anything", () => {
  const search = renderSearch();

  search.press("Escape");

  expect(search.onClose).toHaveBeenCalled();
  expect(search.onOpen).not.toHaveBeenCalled();
});

describe("the preview pane", () => {
  it("shows the note around the highlighted hit, with the matching line marked", async () => {
    fetchNote.mockResolvedValue("one\ntwo\nthree\nfour\nfive");
    searchNotes.mockResolvedValue([{ path: "a.md", line: 3, text: "three" }]);
    const search = renderSearch();

    search.type("three");

    await waitFor(() => expect(search.markedLine()).toContain("three"));
    // The lines either side are the point of the pane: the row above already
    // showed the matching line on its own.
    expect(search.preview()).toContain("two");
    expect(search.preview()).toContain("four");
  });

  it("leaves out the parts of the note too far from the hit", async () => {
    searchNotes.mockResolvedValue([{ path: "a.md", line: 100, text: "line 100" }]);
    const search = renderSearch();

    search.type("line 100");

    await waitFor(() => expect(search.markedLine()).toContain("line 100"));
    expect(search.preview()).toContain("line 80");
    // A 200 line note costs the same as a 40 line one, which is what the
    // window is for.
    expect(search.preview()).not.toContain("line 5\n");
    expect(search.preview()).not.toContain("line 200");
  });

  it("holds at the start of the note when the hit is near the top", async () => {
    searchNotes.mockResolvedValue([{ path: "a.md", line: 2, text: "line 2" }]);
    const search = renderSearch();

    search.type("line 2");

    await waitFor(() => expect(search.markedLine()).toContain("line 2"));
    expect(search.preview()).toContain("line 1");
  });

  it("reads the note only once for two hits that are in it", async () => {
    // Walking between two hits of one note re-centres the pane on the second
    // without asking the vault for the note again.
    searchNotes.mockResolvedValue([
      { path: "a.md", line: 10, text: "line 10" },
      { path: "a.md", line: 90, text: "line 90" },
    ]);
    const search = renderSearch();

    search.type("line");
    await waitFor(() => expect(search.markedLine()).toContain("line 10"));

    search.press("ArrowDown");

    await waitFor(() => expect(search.markedLine()).toContain("line 90"));
    expect(fetchNote).toHaveBeenCalledTimes(1);
  });

  it("says so when the note behind a hit cannot be read", async () => {
    fetchNote.mockRejectedValue(new Error("gone"));
    const search = renderSearch();

    search.type("postgres");

    await waitFor(() => expect(search.preview()).toContain("could not read this note"));
  });
});

describe("backlinks", () => {
  const PATHS = ["archive/notes.md", "index.md", "kafka.md", "reading/borges.md"];

  function renderBacklinks(paths: string[] = PATHS, of = "reading/borges.md") {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <NoteSearch backlinksOf={of} paths={paths} onOpen={onOpen} onClose={onClose} />
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText("backlinks") as HTMLInputElement;

    return {
      onOpen,
      onClose,
      type: (value: string) => fireEvent.change(input, { target: { value } }),
      press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
      rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
      hint: () => screen.getByRole("status").textContent,
      /** The named groups in the order they are drawn, with the rows under each. */
      groups: () =>
        screen.queryAllByRole("group").map((group) => ({
          name: group.getAttribute("aria-label"),
          rows: [...group.querySelectorAll('[role="option"]')].map((row) => row.textContent),
        })),
      /** Which drawn row carries the highlight. */
      selected: () =>
        screen.queryAllByRole("option").findIndex((row) => row.ariaSelected === "true"),
    };
  }

  it("asks the vault for the note's name without waiting to be typed into", async () => {
    renderBacklinks();

    // Every link to the note carries its name, whether it spelled the path out
    // or not, so the name is the one query that cannot miss one.
    await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("borges", false));
  });

  it("keeps the lines that link here and drops the ones that only say the name", async () => {
    searchNotes.mockResolvedValue([
      { path: "index.md", line: 3, text: "see [[borges]]" },
      { path: "index.md", line: 9, text: "borges wrote the library" },
    ]);
    const panel = renderBacklinks();

    await waitFor(() => expect(panel.rows()).toHaveLength(1));
    expect(panel.rows()[0]).toContain("see [[borges]]");
  });

  it("keeps a link that spelled the path out", async () => {
    searchNotes.mockResolvedValue([{ path: "index.md", line: 3, text: "see [[reading/borges]]" }]);
    const panel = renderBacklinks();

    await waitFor(() => expect(panel.rows()).toHaveLength(1));
  });

  it("drops a link that names another note of a similar name", async () => {
    searchNotes.mockResolvedValue([
      { path: "index.md", line: 3, text: "see [[archive/borges]]" },
      { path: "index.md", line: 4, text: "see [[borges]]" },
    ]);
    // With a `borges.md` at the root, a bare name names that one, so neither
    // line is a link to the note in `reading/`.
    const panel = renderBacklinks([...PATHS, "borges.md"]);

    await waitFor(() => expect(panel.hint()).toBe("nothing links here"));
    expect(panel.rows()).toHaveLength(0);
  });

  it("narrows what links here as you type", async () => {
    searchNotes.mockResolvedValue([
      { path: "index.md", line: 3, text: "see [[borges]]" },
      { path: "archive/notes.md", line: 7, text: "the library of [[borges]]" },
    ]);
    const panel = renderBacklinks();
    await waitFor(() => expect(panel.rows()).toHaveLength(2));

    panel.type("library");

    // Typing filters the answer already in hand. Nothing is asked of the vault
    // a second time: what links here is a fixed set.
    await waitFor(() => expect(panel.rows()).toHaveLength(1));
    expect(searchNotes).toHaveBeenCalledTimes(1);
  });

  it("walks the rows on tab", async () => {
    searchNotes.mockResolvedValue([
      { path: "index.md", line: 3, text: "see [[borges]]" },
      { path: "archive/notes.md", line: 7, text: "and [[borges]]" },
    ]);
    const panel = renderBacklinks();
    await waitFor(() => expect(panel.rows()).toHaveLength(2));

    panel.press("Tab");
    panel.press("Enter");

    expect(panel.onOpen).toHaveBeenCalledWith("archive/notes.md", 7);
  });

  it("walks back up on shift tab", async () => {
    searchNotes.mockResolvedValue([
      { path: "index.md", line: 3, text: "see [[borges]]" },
      { path: "archive/notes.md", line: 7, text: "and [[borges]]" },
    ]);
    const panel = renderBacklinks();
    await waitFor(() => expect(panel.rows()).toHaveLength(2));

    panel.press("Tab");
    panel.press("Tab", { shiftKey: true });
    panel.press("Enter");

    expect(panel.onOpen).toHaveBeenCalledWith("index.md", 3);
  });

  it("says so when nothing links here", async () => {
    searchNotes.mockResolvedValue([]);
    const panel = renderBacklinks();

    await waitFor(() => expect(panel.hint()).toBe("nothing links here"));
  });

  describe("grouped by the name in front", () => {
    it("draws a heading per relation name and leaves the untyped links last", async () => {
      searchNotes.mockResolvedValue([
        { path: "index.md", line: 3, text: "depends-on:: [[borges]]" },
        { path: "index.md", line: 4, text: "see [[borges]]" },
        { path: "archive/notes.md", line: 7, text: "depends-on:: [[borges]]" },
      ]);
      const panel = renderBacklinks();

      await waitFor(() => expect(panel.rows()).toHaveLength(3));
      expect(panel.groups()).toHaveLength(1);
      expect(panel.groups()[0]?.name).toBe("depends-on");
      expect(panel.groups()[0]?.rows).toHaveLength(2);
      // Under no heading of its own, and after the two that have one.
      expect(panel.rows()[2]).toContain("see [[borges]]");
    });

    it("types a line by the target that resolves here, not by the name alone", async () => {
      // The panel keeps this line in both notes' backlinks, and only one end of
      // it is a dependency. Reading the name without the target would tell
      // kafka it is one.
      const line = { path: "index.md", line: 3, text: "depends-on:: [[borges]] because [[kafka]]" };
      searchNotes.mockResolvedValue([line]);
      const borges = renderBacklinks();

      await waitFor(() => expect(borges.rows()).toHaveLength(1));
      expect(borges.groups()[0]?.name).toBe("depends-on");

      cleanup();
      const kafka = renderBacklinks(PATHS, "kafka.md");

      await waitFor(() => expect(kafka.rows()).toHaveLength(1));
      expect(kafka.groups()).toHaveLength(0);
    });

    it("groups a name nothing has defined under its own spelling", async () => {
      searchNotes.mockResolvedValue([
        { path: "index.md", line: 3, text: "invented-thing:: [[borges]]" },
      ]);
      const panel = renderBacklinks();

      await waitFor(() => expect(panel.rows()).toHaveLength(1));
      expect(panel.groups()[0]?.name).toBe("invented-thing");
    });

    it("draws a relation actually named untyped beside the untyped group", async () => {
      // Rule 9 makes `untyped` as legal a name as any other, so the two groups
      // can be siblings. Keyed by a word rather than by position, React would
      // call them the same child and remount one instead of updating it.
      const warned = vi.spyOn(console, "error").mockImplementation(() => {});
      searchNotes.mockResolvedValue([
        { path: "index.md", line: 3, text: "untyped:: [[borges]]" },
        { path: "index.md", line: 4, text: "see [[borges]]" },
      ]);
      const panel = renderBacklinks();

      await waitFor(() => expect(panel.rows()).toHaveLength(2));

      expect(panel.groups().map(({ name }) => name)).toEqual(["untyped"]);
      expect(warned).not.toHaveBeenCalled();
      warned.mockRestore();
    });

    // The two below are the ones grouping at render alone would ship broken:
    // the highlight, the preview and Enter all read one array, and moving a row
    // on screen without moving it there points them at another line.
    const MOVED = [
      { path: "index.md", line: 4, text: "see [[borges]]" },
      { path: "archive/notes.md", line: 7, text: "depends-on:: [[borges]]" },
    ];

    it("opens the row drawn first, not the row ranked first", async () => {
      searchNotes.mockResolvedValue(MOVED);
      const panel = renderBacklinks();
      await waitFor(() => expect(panel.rows()).toHaveLength(2));

      panel.press("Enter");

      expect(panel.onOpen).toHaveBeenCalledWith("archive/notes.md", 7);
    });

    it("walks to the row drawn second", async () => {
      searchNotes.mockResolvedValue(MOVED);
      const panel = renderBacklinks();
      await waitFor(() => expect(panel.rows()).toHaveLength(2));

      panel.press("ArrowDown");

      expect(panel.selected()).toBe(1);
      panel.press("Enter");
      expect(panel.onOpen).toHaveBeenCalledWith("index.md", 4);
    });
  });
});

describe("todos", () => {
  const TODOS = [
    { path: "projects/kasten.md", line: 12, text: "- [ ] wire up the pane 📅 2026-08-14" },
    { path: "projects/kasten.md", line: 20, text: "- [/] write the docs" },
    { path: "projects/kasten.md", line: 21, text: "- [x] read the spec" },
    // A `## Time` line. The endpoint carries these back for phase 3, and they
    // are not todos, so this panel must not draw one.
    { path: "daily/2026-08-10.md", line: 5, text: "- 09:12-10:32 wire up the pane" },
  ];

  function renderTodos() {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <NoteSearch todos onOpen={onOpen} onClose={onClose} />
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText("todos") as HTMLInputElement;

    return {
      onOpen,
      onClose,
      type: (value: string) => fireEvent.change(input, { target: { value } }),
      press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
      rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
    };
  }

  it("lists the open todos, drawing the state and the words", async () => {
    fetchTodos.mockResolvedValue(TODOS);
    const panel = renderTodos();

    await waitFor(() => expect(panel.rows()).toHaveLength(2));
    expect(panel.rows()[0]).toContain("☐");
    expect(panel.rows()[0]).toContain("wire up the pane");
    expect(panel.rows()[0]).toContain("2026-08-14");
    expect(panel.rows()[1]).toContain("◐");
  });

  it("leaves out what is finished and what was never a todo", async () => {
    fetchTodos.mockResolvedValue(TODOS);
    const panel = renderTodos();

    await waitFor(() => expect(panel.rows()).toHaveLength(2));
    expect(panel.rows().join()).not.toContain("read the spec");
    expect(panel.rows().join()).not.toContain("09:12");
  });

  it("narrows the list as you type without asking the vault again", async () => {
    fetchTodos.mockResolvedValue(TODOS);
    const panel = renderTodos();
    await waitFor(() => expect(panel.rows()).toHaveLength(2));

    panel.type("docs");

    // What the vault holds is a fixed set, so typing ranks the answer in hand.
    await waitFor(() => expect(panel.rows()).toHaveLength(1));
    expect(fetchTodos).toHaveBeenCalledTimes(1);
  });

  it("opens the note on the line the todo sits on", async () => {
    fetchTodos.mockResolvedValue(TODOS);
    const panel = renderTodos();
    await waitFor(() => expect(panel.rows()).toHaveLength(2));

    panel.press("Enter");

    expect(panel.onOpen).toHaveBeenCalledWith("projects/kasten.md", 12);
  });
});

it("renders the markdown in the preview rather than showing its syntax", async () => {
  fetchNote.mockResolvedValue("line 1\n## a heading\nwith **bold** in it\nline 4");
  searchNotes.mockResolvedValue([{ path: "a.md", line: 3, text: "with **bold** in it" }]);
  const search = renderSearch();

  search.type("bold");

  await waitFor(() => expect(search.preview()).toContain("a heading"));
  expect(search.preview()).not.toContain("##");
  expect(search.preview()).not.toContain("**");
  expect(document.querySelector(".cm-strong")?.textContent).toBe("bold");
});

it("still numbers the lines and marks the hit once the markdown is rendered", async () => {
  fetchNote.mockResolvedValue("line 1\n## a heading\nwith bold in it\nline 4");
  searchNotes.mockResolvedValue([{ path: "a.md", line: 3, text: "with bold in it" }]);
  const search = renderSearch();

  search.type("bold");

  await waitFor(() => expect(search.preview()).toContain("a heading"));
  // The numbers are the note's own, not the window's, so a hit deep in a note
  // still says where it is.
  expect(search.lineNumbers()).toContain("3");
  expect(search.markedLine()).toContain("with bold in it");
});
