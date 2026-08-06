import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NoteSearch } from "@/components/note-search";

// Standing in for the module rather than for `fetch`, the way the finder's
// tests do: what this component owns is what it asks the vault for and how
// often, not the HTTP underneath.
const { searchNotes, fetchNote } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote }));

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
    previewHit: () => screen.queryByTestId("preview-hit")?.textContent ?? "",
  };
}

beforeEach(() => {
  searchNotes.mockReset();
  fetchNote.mockReset();
  searchNotes.mockResolvedValue(HITS);
  fetchNote.mockResolvedValue(NOTE);
});

/** A note long enough that a window around a hit has to leave some of it out. */
const NOTE = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");

it("asks the vault for what was typed", async () => {
  const search = renderSearch();

  search.type("postgres");

  await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("postgres"));
});

it("asks nothing of the vault until the typing settles", async () => {
  const search = renderSearch();

  search.type("p");
  search.type("po");
  search.type("pos");

  // One query for the word, not one per letter. Every keystroke firing its own
  // scan is the thing the delay exists to stop.
  await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("pos"));
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

    await waitFor(() => expect(search.previewHit()).toContain("three"));
    // The lines either side are the point of the pane: the row above already
    // showed the matching line on its own.
    expect(search.preview()).toContain("two");
    expect(search.preview()).toContain("four");
  });

  it("leaves out the parts of the note too far from the hit", async () => {
    searchNotes.mockResolvedValue([{ path: "a.md", line: 100, text: "line 100" }]);
    const search = renderSearch();

    search.type("line 100");

    await waitFor(() => expect(search.previewHit()).toContain("line 100"));
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

    await waitFor(() => expect(search.previewHit()).toContain("line 2"));
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
    await waitFor(() => expect(search.previewHit()).toContain("line 10"));

    search.press("ArrowDown");

    await waitFor(() => expect(search.previewHit()).toContain("line 90"));
    expect(fetchNote).toHaveBeenCalledTimes(1);
  });

  it("says so when the note behind a hit cannot be read", async () => {
    fetchNote.mockRejectedValue(new Error("gone"));
    const search = renderSearch();

    search.type("postgres");

    await waitFor(() => expect(search.preview()).toContain("could not read this note"));
  });
});
