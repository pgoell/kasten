import { fireEvent } from "@testing-library/react";
import { folderCandidates, rankCandidates, rankFolders } from "@/lib/fuzzy";
import { MANY_PATHS, renderPrompt } from "./note-prompt-fixture";

const { createNote, renameNote, moveFolder } = vi.hoisted(() => ({
  createNote: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ createNote }));
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));

// Call counters for the two halves of the ranking. `spy: true` keeps the real
// implementations, so the prompt still ranks for real and the only thing that
// changes is that the calls are recorded. Which half runs how often is
// behaviour here, not an implementation detail: deriving the folder set is the
// larger half and follows the vault, so a keystroke that walks every path again
// is the regression the memo exists to prevent.
vi.mock("@/lib/fuzzy", { spy: true });

describe("the new note prompt", () => {
  beforeEach(() => {
    createNote.mockResolvedValue({ path: "daily/note.md", content: "" });
  });

  afterEach(() => {
    createNote.mockReset();
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
});
