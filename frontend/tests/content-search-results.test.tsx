import { fireEvent, screen, waitFor } from "@testing-library/react";
import { HITS, renderContent, searchHooks } from "./content-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/core/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

// Kept beside the journeys: the entrance ends 372 ms after the first answer, too short a
// window for a journey to type a second query and read the class before it ends anyway.
it("gives no entrance to a note that a later answer adds", async () => {
  const later = {
    path: "later/new.md",
    line: 2,
    text: "postgres later",
    date: "2026-10-20",
    tags: [],
  };
  searchNotes.mockImplementation(async (query: string) =>
    query === "postgres" ? HITS : [...HITS, later],
  );
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  search.type("postgres later");

  await waitFor(() => expect(search.notes()).toContain("later/new.md"));
  expect(screen.getByRole("group", { name: "later/new.md" }).className).not.toContain("k-enter");
});

// #1773: the regex and whole word toggles.
describe("the regex and whole word toggles", () => {
  const regex = () => screen.getByRole("button", { name: "Regular expression" });
  const word = () => screen.getByRole("button", { name: "Whole word" });

  it("asks a literal with no flags while both toggles are off", async () => {
    const search = renderContent();

    search.type("postgres");

    await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("postgres", false, {}));
    expect(regex()).toHaveAttribute("aria-pressed", "false");
    expect(word()).toHaveAttribute("aria-pressed", "false");
  });

  it("a click on the regex toggle asks again as a regex, the archive count too, and keeps the focus", async () => {
    const search = renderContent();
    search.type("postgres");
    await waitFor(() => expect(search.rows()).toHaveLength(2));

    fireEvent.mouseDown(regex());
    fireEvent.click(regex());

    expect(regex()).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(searchNotes).toHaveBeenCalledWith("postgres", false, { regex: true }),
    );
    expect(searchNotes).toHaveBeenCalledWith("postgres", true, { regex: true });
    expect(search.input).toHaveFocus();
  });

  it("Alt+W turns whole word on, and Alt+R with it sends both", async () => {
    const search = renderContent();
    search.type("plan");

    search.press("w", { altKey: true, code: "KeyW" });
    await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("plan", false, { word: true }));
    // Option+R on a Mac types ®, so the key is read by its code.
    search.press("®", { altKey: true, code: "KeyR" });

    await waitFor(() =>
      expect(searchNotes).toHaveBeenCalledWith("plan", false, { word: true, regex: true }),
    );
    expect(word()).toHaveAttribute("aria-pressed", "true");
    search.press("w", { altKey: true, code: "KeyW" });
    expect(word()).toHaveAttribute("aria-pressed", "false");
  });

  it("with the regex toggle on, lists the lines rg found, though the pattern is no subsequence of them", async () => {
    searchNotes.mockImplementation(async (query: string) =>
      query === "\\bplan\\b"
        ? [{ path: "plan.md", line: 1, text: "the plan holds", date: "2026-10-20", tags: [] }]
        : [],
    );
    const search = renderContent();

    fireEvent.click(regex());
    search.type("\\bplan\\b");

    await waitFor(() => expect(search.rows()).toEqual(["1the plan holds"]));
    expect(screen.getByText("plan", { selector: "span.text-k-accent" })).toBeInTheDocument();
  });

  it("a regex rg refuses shows rg's message under the list, not no notes match", async () => {
    const { PatternError } =
      await vi.importActual<typeof import("@/lib/core/api")>("@/lib/core/api");
    const message = "rg: regex parse error:\n    (?:(open)\n    ^\nerror: unclosed group";
    searchNotes.mockRejectedValue(new PatternError(message));
    const search = renderContent();

    fireEvent.click(regex());
    search.type("(open");

    await waitFor(() => expect(search.hint()).toBe(message));
    expect(search.rows()).toEqual([]);
  });
});
