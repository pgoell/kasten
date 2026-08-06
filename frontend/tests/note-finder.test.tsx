import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { NoteFinder } from "@/components/note-finder";

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

function renderFinder(vault = PATHS) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const queryClient = new QueryClient();

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
});
