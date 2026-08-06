import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NoteSearch } from "@/components/note-search";

// Standing in for the module rather than for `fetch`, the way the finder's
// tests do: what this component owns is what it asks the vault for and how
// often, not the HTTP underneath.
const { searchNotes } = vi.hoisted(() => ({ searchNotes: vi.fn() }));
vi.mock("@/lib/api", () => ({ searchNotes }));

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
  };
}

beforeEach(() => {
  searchNotes.mockReset();
  searchNotes.mockResolvedValue(HITS);
});

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
