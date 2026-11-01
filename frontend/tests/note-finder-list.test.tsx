import { fireEvent, screen } from "@testing-library/react";
import { MANY_PATHS, PATHS, renderFinder } from "./note-finder-fixture";

// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is which note it
// asks for and how often, not the HTTP.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

describe("the note finder", () => {
  beforeEach(() => {
    fetchNote.mockResolvedValue("# a note");
  });

  afterEach(() => {
    fetchNote.mockReset();
  });

  it("names the dialog for a note", () => {
    renderFinder();

    expect(screen.getByRole("dialog", { name: "Find note" })).toBeTruthy();
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
});
