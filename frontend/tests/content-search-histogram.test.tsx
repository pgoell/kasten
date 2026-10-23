import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HITS, lines, renderContent, searchHooks } from "./content-search-fixture";
import { COARSE, stubMatchMedia } from "./match-media";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The four notes a busy week is spread over: 8, 8, 7 and 7 lines. */
const BUSY_WEEK = [
  ...lines("reference/a.md", 8, "2026-09-16"),
  ...lines("reference/b.md", 8, "2026-09-16"),
  ...lines("projects/c.md", 7, "2026-09-17"),
  ...lines("projects/d.md", 7, "2026-09-18"),
];

it("draws fourteen bars, one for each week from week 30 to week 43", () => {
  const search = renderContent();

  expect(search.bars().map((bar) => bar.getAttribute("aria-label")?.split(",")[0])).toEqual(
    Array.from({ length: 14 }, (_, at) => `Week ${30 + at}`),
  );
});

it("draws an empty week with no height at all", async () => {
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(2));
  expect(search.fill(30).style.height).toBe("0%");
});

it("scales the busiest week to full height and the others in proportion", async () => {
  searchNotes.mockResolvedValue([
    ...lines("a/one.md", 30, "2026-09-16"),
    ...lines("b/two.md", 15, "2026-10-07"),
  ]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.bar(38).getAttribute("aria-label")).toBe("Week 38, 30 lines"));
  expect(search.fill(38).style.height).toBe("100%");
  expect(search.fill(41).style.height).toBe("50%");
});

it("labels each bar with its ISO week", () => {
  const search = renderContent();

  expect(search.bar(30).textContent).toContain("W30");
  expect(search.bar(43).textContent).toContain("W43");
});

it("marks the current week in the accent and bold", () => {
  const search = renderContent();

  // The label is split: a W that hides below md, then the number. The bold label is the one to read.
  const current = search.bar(43).querySelector<HTMLElement>(".font-bold") as HTMLElement;
  expect(current.textContent).toBe("W43");
  expect(current.className).toContain("text-k-accent");
  expect(search.bar(42).querySelector(".font-bold")).toBeNull();
});

it("shows a bar's count on hover", async () => {
  searchNotes.mockResolvedValue(lines("a/one.md", 30, "2026-09-16"));
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.bar(38).getAttribute("aria-label")).toBe("Week 38, 30 lines"));
  expect(within(search.bar(38)).queryByText("30")).toBeNull();

  fireEvent.mouseEnter(search.bar(38));

  expect(within(search.bar(38)).getByText("30")).toBeTruthy();
});

it("names each bar by its week and line count, singular for one", async () => {
  searchNotes.mockResolvedValue([
    ...lines("a/one.md", 30, "2026-09-16"),
    ...lines("b/two.md", 1, "2026-10-21"),
  ]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.bar(38).getAttribute("aria-label")).toBe("Week 38, 30 lines"));
  expect(search.bar(43).getAttribute("aria-label")).toBe("Week 43, 1 line");
  expect(search.bar(30).getAttribute("aria-label")).toBe("Week 30, 0 lines");
});

it("marks the chosen bar as pressed and no other", async () => {
  const search = renderContent();

  fireEvent.click(search.bar(38));

  expect(search.bar(38).getAttribute("aria-pressed")).toBe("true");
  expect(search.bar(43).getAttribute("aria-pressed")).toBe("false");
});

it("narrows the results to the week a bar is clicked on", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(search.bar(38));

  expect(search.rows()).toHaveLength(1);
  expect(search.rows()[0]).toContain("postgres runs in its own container");
});

it("says what the chosen week holds, in a sentence", async () => {
  searchNotes.mockResolvedValue(BUSY_WEEK);
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.bar(38).getAttribute("aria-label")).toBe("Week 38, 30 lines"));
  fireEvent.click(search.bar(38));

  expect(screen.getByText("30 lines in 4 notes written 14 to 20 September 2026.").textContent).toBe(
    "30 lines in 4 notes written 14 to 20 September 2026.",
  );
});

it("clears the chosen week with the All weeks button", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(search.bar(38));
  fireEvent.click(screen.getByRole("button", { name: "All weeks" }));

  expect(search.rows()).toHaveLength(2);
  expect(search.bar(38).getAttribute("aria-pressed")).toBe("false");
});

it("clears the chosen week on a second click on its bar", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(search.bar(38));
  fireEvent.click(search.bar(38));

  expect(search.rows()).toHaveLength(2);
  expect(search.bar(38).getAttribute("aria-pressed")).toBe("false");
});

it("keeps the chosen week when the query changes", async () => {
  const search = renderContent({ week: "2026-W38" });

  search.type("postgres runs");

  await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("postgres runs", false));
  expect(search.bar(38).getAttribute("aria-pressed")).toBe("true");
});

it("says zero lines in zero notes for a week with none, and All weeks still clears it", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(search.bar(30));

  expect(screen.getByText("0 lines in 0 notes written 20 to 26 July 2026.").textContent).toBe(
    "0 lines in 0 notes written 20 to 26 July 2026.",
  );
  fireEvent.click(screen.getByRole("button", { name: "All weeks" }));
  expect(screen.queryByRole("button", { name: "All weeks" })).toBeNull();
});

it("lists a line with no date under All weeks and counts it in no week", async () => {
  searchNotes.mockResolvedValue([
    ...HITS,
    { path: "undated.md", line: 1, text: "postgres undated", date: null, tags: [] },
  ]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(3));
  expect(search.notes()).toContain("undated.md");
  expect(search.bar(43).getAttribute("aria-label")).toBe("Week 43, 1 line");
});

it("lists a line older than fourteen weeks under All weeks and in no bar", async () => {
  searchNotes.mockResolvedValue([
    ...HITS,
    { path: "old/june.md", line: 4, text: "postgres in june", date: "2026-06-01", tags: [] },
  ]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(3));
  expect(search.notes()).toContain("old/june.md");
  expect(search.bar(43).getAttribute("aria-label")).toBe("Week 43, 1 line");
});

it("counts an archived line in the week it was written", async () => {
  const search = renderContent({ archive: true });

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(3));
  expect(search.bar(40).getAttribute("aria-label")).toBe("Week 40, 1 line");
});

it("keeps each bar as wide as its area under a finger", () => {
  // jsdom applies no media query, so the coarse pointer is stubbed and the bar's
  // classes are read: a centred column shrinks the area holding the bar to nothing.
  stubMatchMedia({ [COARSE]: true });
  const search = renderContent();

  expect(search.bar(38).className).not.toContain("pointer-coarse:items-center");
  expect(search.bar(38).className).toContain("pointer-coarse:min-h-11");
});

it("shows no rows, empty bars and no counts once the query is cleared", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  search.type("");

  await waitFor(() => expect(search.rows()).toHaveLength(0));
  expect(search.bars().map((bar) => bar.getAttribute("aria-label"))).toEqual(
    Array.from({ length: 14 }, (_, at) => `Week ${30 + at}, 0 lines`),
  );
  expect(screen.queryByRole("button", { name: /^projects/ })).toBeNull();
  expect(screen.getByRole("button", { name: /^Include the archive/ }).textContent).toBe(
    "Include the archive",
  );
});
