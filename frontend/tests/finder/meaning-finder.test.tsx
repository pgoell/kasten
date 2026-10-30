import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MeaningFinder } from "@/components/finder/meaning-finder";
import type { RankedAnswer } from "@/lib/api";
import { LEADER_COLUMNS } from "@/lib/leader-keys";
import { paletteEntries } from "@/lib/palette";
import { open } from "../keybindings-fixture";
import { stubCommands } from "../stub-commands";

// The api module builds its client at import time; standing in for the module
// is the level this component owns: what it asks and what it shows.
const { rankedSearch } = vi.hoisted(() => ({ rankedSearch: vi.fn() }));
vi.mock("@/lib/api", () => ({ rankedSearch }));

function answer(over: Partial<RankedAnswer> = {}): RankedAnswer {
  return { hits: [], meaning: true, indexed: 3, notes: 3, ...over };
}

const [BELLO, HAUS, GARDEN] = [
  { path: "pets/Bello.md", heading: "Bello", text: "Mein Hund bellt", score: 0.03 },
  { path: "Haus.md", heading: "Wohnen > Miete", text: "Die Häuser", score: 0.02 },
  { path: "Garden.md", heading: "", text: "The gardens bloom", score: 0.01 },
];
const HITS = [BELLO, HAUS, GARDEN];

function renderFinder(archive = false) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MeaningFinder archive={archive} onOpen={onOpen} onClose={onClose} />
    </QueryClientProvider>,
  );
  const input = screen.getByLabelText("find by meaning");
  return {
    onOpen,
    onClose,
    type: (value: string) => fireEvent.change(input, { target: { value } }),
    press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
    rows: () => screen.queryAllByRole("option"),
    highlighted: () => screen.queryByRole("option", { selected: true })?.textContent,
    hint: () => screen.getByRole("status").textContent,
  };
}

describe("the meaning finder", () => {
  beforeEach(() => {
    rankedSearch.mockImplementation(async (q: string) => answer({ hits: q === "" ? [] : HITS }));
  });

  afterEach(() => {
    rankedSearch.mockReset();
  });

  it("lists each note with its best piece's heading and text", async () => {
    const finder = renderFinder();
    finder.type("dog");

    await waitFor(() => expect(finder.rows()).toHaveLength(3));
    expect(finder.rows()[0]?.textContent).toBe("BelloBelloMein Hund bellt");
    expect(finder.rows()[1]?.textContent).toContain("Wohnen > Miete");
    expect(rankedSearch).toHaveBeenLastCalledWith("dog", false);
  });

  it("walks with arrows, tab and ctrl j k, opens on Enter, closes on Escape", async () => {
    const finder = renderFinder();
    finder.type("dog");
    await waitFor(() => expect(finder.rows()).toHaveLength(3));

    finder.press("ArrowDown");
    finder.press("j", { ctrlKey: true });
    expect(finder.highlighted()).toContain("Garden");
    finder.press("k", { ctrlKey: true });
    finder.press("Tab", { shiftKey: true });
    finder.press("ArrowUp");
    expect(finder.highlighted()).toContain("Bello");
    finder.press("Tab");
    finder.press("Enter");
    expect(finder.onOpen).toHaveBeenCalledWith("Haus.md");
    finder.press("Escape");
    expect(finder.onClose).toHaveBeenCalledTimes(1);
  });

  it("a tap on a row opens its note", async () => {
    const finder = renderFinder();
    finder.type("dog");
    await waitFor(() => expect(finder.rows()).toHaveLength(3));

    fireEvent.click(finder.rows()[2] as HTMLElement);

    expect(finder.onOpen).toHaveBeenCalledWith("Garden.md");
  });

  it("says how far the index has got before anything is typed", async () => {
    rankedSearch.mockResolvedValue(answer({ indexed: 481, notes: 625 }));
    const finder = renderFinder();

    await waitFor(() => expect(finder.hint()).toBe("index holds 481 of 625 notes, still filling"));
    expect(rankedSearch).toHaveBeenCalledWith("", false);
    expect(finder.rows()).toHaveLength(0);
  });

  it("says when the words answered alone, and when nothing matched", async () => {
    rankedSearch.mockResolvedValue(answer({ meaning: false }));
    const finder = renderFinder();
    finder.type("zzz");

    await waitFor(() =>
      expect(finder.hint()).toBe("by words only, the model is loading or off; no notes match"),
    );
  });

  it("says searching, not no match, while the answer is on its way", async () => {
    rankedSearch.mockImplementation((q: string) =>
      q === "" ? Promise.resolve(answer()) : new Promise<RankedAnswer>(() => {}),
    );
    const finder = renderFinder();
    await waitFor(() => expect(rankedSearch).toHaveBeenCalledWith("", false));
    finder.type("dog");

    await waitFor(() => expect(rankedSearch).toHaveBeenLastCalledWith("dog", false));
    expect(finder.hint()).toBe("searching");
  });

  it("says when the search failed", async () => {
    rankedSearch.mockRejectedValue(new Error("GET /api/ranked failed with 500"));
    const finder = renderFinder();

    await waitFor(() => expect(finder.hint()).toBe("the ranked search failed"));
  });

  it("asks with the archive when the toggle has it in", async () => {
    const finder = renderFinder(true);
    finder.type("dog");

    await waitFor(() => expect(rankedSearch).toHaveBeenLastCalledWith("dog", true));
  });

  it("never shows an older query's answer over a newer one's", async () => {
    let late: (value: RankedAnswer) => void = () => {};
    rankedSearch.mockImplementation((q: string) => {
      if (q === "hund") return new Promise<RankedAnswer>((resolve) => (late = resolve));
      return Promise.resolve(answer({ hits: q === "" ? [] : [GARDEN] }));
    });
    const finder = renderFinder();
    finder.type("hund");
    await waitFor(() => expect(rankedSearch).toHaveBeenLastCalledWith("hund", false));
    finder.type("garden");
    await waitFor(() => expect(finder.rows()).toHaveLength(1));

    late(answer({ hits: [BELLO] }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(finder.rows()).toHaveLength(1);
    expect(finder.rows()[0]?.textContent).toContain("Garden");
  });
});

describe("the meaning finder's entry", () => {
  it("space f m runs it in vim's normal mode", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "f" });
    fireEvent.keyDown(editor, { key: "m" });

    expect(commands.findMeaning).toHaveBeenCalledTimes(1);
    expect(commands.findNote).not.toHaveBeenCalled();
  });

  // The palette is how vim off and a phone reach every leader command.
  it("is a palette row, and in the which-key Find column", () => {
    const commands = stubCommands();
    const row = paletteEntries(commands, null).find((entry) => entry.label === "Find by meaning");

    row?.run();

    expect(commands.findMeaning).toHaveBeenCalledTimes(1);
    expect(LEADER_COLUMNS.find((group) => group.title === "Find")?.keys).toContain("fm");
  });
});
