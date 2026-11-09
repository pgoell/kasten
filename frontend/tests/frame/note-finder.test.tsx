/**
 * What one keystroke in the note finder costs end to end, in a real browser.
 *
 * The node gate in `tests/perf/ranking.test.ts` times the ranking alone, which
 * is the part a regression is easiest to pin on. This file times the whole
 * keystroke: the ranking, React's reconciliation and the DOM commit. jsdom
 * cannot answer this question at all, because it lays nothing out and paints
 * nothing, so a number out of it would not be true.
 *
 * The finder ranks every note where the prompt ranks every folder, twelve times
 * the candidates at 10,000 notes, which is why it is measured apart rather than
 * assumed to cost what `tests/frame/note-prompt.test.tsx` records.
 *
 * The design target is 16ms end to end, one frame, about 4ms of it JS. The
 * test below gates on the work, not the clock, so a loaded runner cannot turn
 * it red.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { NoteFinder } from "@/components/finder/note-finder";
import type * as Fuzzy from "@/lib/search/fuzzy";
import { syntheticVault } from "../../bench/fixtures";
import { MANY_PATHS, PATHS, renderFinder } from "../note-finder-fixture";

// Counted, not timed: a keystroke that ranks twice is caught with no clock.
const ranks = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/search/fuzzy", async (importOriginal) => {
  const actual = await importOriginal<typeof Fuzzy>();
  return {
    ...actual,
    rankCandidates: (...args: Parameters<typeof actual.rankCandidates>) => {
      ranks.calls += 1;
      return actual.rankCandidates(...args);
    },
  };
});

// The preview reads a note when the highlight holds still, and a real request
// inside the timed window would be measuring the network. It never fires during
// a run, the delay outlasting the gap between keystrokes, but a stub is what
// makes that a fact rather than a hope.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn(() => Promise.resolve("")) }));
vi.mock("@/lib/core/api", () => ({
  // A spy, so a file row can be shown never to be read as a note.
  fetchNote,
  // Named because the module is replaced whole: the editor behind the preview
  // imports these, and a factory short of a name breaks the import itself.
  fetchImages: () => Promise.resolve([]),
  uploadAsset: () => Promise.resolve(),
  // The live preview's video times reach `transcript.ts`, which imports this.
  fetchTranscript: () => Promise.resolve(),
}));

/**
 * The cap `note-finder.tsx` mounts to. Written out here rather than imported,
 * so a cap that grew back would turn this red instead of following it.
 */
const VISIBLE_NOTES = 20;

/** Untimed keystrokes, so the first timed one pays no warm-up cost. */
const WARMUPS = 3;

/**
 * One distinct character per run, warmups included, and one character rather
 * than a growing query so every run ranks a comparable share of the vault. A
 * repeat would put back the value the input already holds, React would bail out
 * of the render, and the run would time an empty frame.
 *
 * One letter is also the dearest query the finder answers: it rejects almost
 * nothing, so nearly every note pays for the scoring table.
 */
const KEYS = "abcdefghijklmnopqr";

/** Options currently mounted in the finder's listbox. */
function optionCount(): number {
  return document.querySelectorAll('[role="option"]').length;
}

/** Resolves on the browser's next animation frame. */
function frame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * React's controlled input ignores a plain `value` assignment: it remembers what
 * it last wrote and treats a value it already knows as no change. Going through
 * the prototype's setter is what makes the component see the keystroke.
 */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Milliseconds from dispatching the keystroke to the paint that follows it. */
async function frameCost(act: () => void): Promise<number> {
  const start = performance.now();
  act();
  // Two turns, not one. The first callback runs before the paint that carries
  // React's commit to the screen, and the second cannot run until that paint is
  // over, so the pair is what puts the paint inside the measured window.
  await frame();
  await frame();
  return performance.now() - start;
}

/** Median of `times`, which one descheduled run cannot drag the way it drags a mean. */
function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface Measurement {
  /**
   * Median of the two-rAF window, logged as context and asserted on by nothing.
   * Its floor is the refresh rate rather than the work: two animation frames
   * cannot resolve in under two refresh periods, about 33ms at 60Hz, however
   * little the keystroke costs.
   */
  cost: number;
  /**
   * Median of the synchronous half alone: ranking, reconciliation and the DOM
   * commit, with no waiting for the screen. This is the printed number. It moves
   * with the work rather than in refresh-period steps, and it is what decides
   * whether the frame drops.
   */
  commit: number;
  /** Options mounted on open, where the query is empty and every note matches. */
  onOpen: number;
  /** Distinct option counts seen across the runs, which the cap holds at its own number. */
  counts: Set<number>;
  /** The best-ranked row after each keystroke. One of them means nothing re-ranked. */
  tops: Set<string>;
  /** Calls to the ranker per keystroke, which the one-per-keystroke bound reads. */
  rankings: Set<number>;
}

async function measure(noteCount: number): Promise<Measurement> {
  const { paths } = syntheticVault(noteCount);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  root.render(
    // Not optional scaffolding: the preview asks for the query client on every
    // render, so without a provider it throws on mount.
    <QueryClientProvider client={new QueryClient()}>
      <NoteFinder paths={paths} onOpen={() => {}} onClose={() => {}} />
    </QueryClientProvider>,
  );

  // The first render is scheduled rather than synchronous, and none of it
  // belongs in the timed runs. Waiting on a row rather than on the input waits
  // for the whole first commit, list included.
  while (optionCount() === 0) await frame();

  const input = document.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (!input) throw new Error("the finder mounted without its input");

  const onOpen = optionCount();
  const times: number[] = [];
  const commits: number[] = [];
  const counts = new Set<number>();
  const tops = new Set<string>();
  const rankings = new Set<number>();

  for (const [index, key] of [...KEYS].entries()) {
    let commit = 0;
    const ranked = ranks.calls;
    const elapsed = await frameCost(() => {
      const start = performance.now();
      typeInto(input, key);
      // React flushes a change event synchronously, so by the time the dispatch
      // returns the new rows are already in the DOM and only the paint is left.
      commit = performance.now() - start;
    });
    counts.add(optionCount());
    rankings.add(ranks.calls - ranked);
    tops.add(document.querySelector('[role="option"]')?.textContent ?? "");
    if (index >= WARMUPS) {
      times.push(elapsed);
      commits.push(commit);
    }
  }

  root.unmount();
  container.remove();
  return { cost: median(times), commit: median(commits), onOpen, counts, tops, rankings };
}

const RANKS_PER_KEYSTROKE = 1;

describe("one keystroke in the note finder", () => {
  // The default five seconds does not cover eighteen keystrokes over a vault
  // this size; the counts gate it, and the cost is only printed.
  it("renders only the visible notes per keystroke at 10,000 notes", async () => {
    const { cost, commit, onOpen, counts, tops, rankings } = await measure(10000);

    console.log(
      `the finder, 10,000 notes: ${cost.toFixed(1)}ms median keystroke, ${commit.toFixed(1)}ms of it before the paint`,
    );
    console.log(
      `the finder, 10,000 notes: ${onOpen} options on open, ${[...counts].join("/")} while typing`,
    );
    // Eighteen different queries agreeing on the best row would mean the
    // keystrokes never reached the component, and the medians above would
    // belong to a render that did nothing.
    expect(tops.size).toBeGreaterThan(1);
    // One ranking per keystroke: the memo is keyed on the query alone. A second
    // call per keystroke would double the work and pass every check above.
    expect([...rankings]).toEqual([RANKS_PER_KEYSTROKE]);
    // What the cap is for. Every one of the 10,000 notes matches an empty
    // query, and mounting a button for each would be most of the keystroke.
    expect(onOpen).toBeLessThanOrEqual(VISIBLE_NOTES);
    expect(Math.max(...counts)).toBeLessThanOrEqual(VISIBLE_NOTES);
  }, 120_000);

  it("records what it costs at 50,000 notes", async () => {
    const { cost, commit, onOpen, counts } = await measure(50000);

    console.log(
      `the finder, 50,000 notes: ${cost.toFixed(1)}ms median keystroke, ${commit.toFixed(1)}ms of it before the paint`,
    );
    console.log(
      `the finder, 50,000 notes: ${onOpen} options on open, ${[...counts].join("/")} while typing`,
    );
  }, 600_000);
});

describe("the note finder's list", () => {
  it("opens on the whole vault", () => {
    const finder = renderFinder();

    expect(finder.input).toHaveValue("");
    expect(finder.rows()).toEqual(PATHS);
  });

  it("mounts the twenty best-ranked notes and no more", () => {
    const finder = renderFinder(MANY_PATHS);

    finder.type("no");

    const rows = finder.rows();
    expect(rows).toHaveLength(VISIBLE_NOTES);
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

  it("says the vault is empty when it holds no notes", () => {
    const finder = renderFinder([]);

    expect(finder.rows()).toEqual([]);
    expect(finder.hint()).toBe("the vault has no notes");
  });
});

describe("the note finder over files", () => {
  const FILES = ["lit/DDIA.epub", "notes/page.html"];

  // The frame opens at a phone's width, which mounts no preview.
  beforeEach(() => page.viewport(1440, 900));

  it("gives an epub and an html row their kind", () => {
    const finder = renderFinder(PATHS, undefined, { files: FILES });

    expect(finder.option("lit/DDIA.epub")).toHaveTextContent(/EPUB$/);
    expect(finder.option("notes/page.html")).toHaveTextContent(/HTML$/);
  });

  it.each([
    ["an epub with a note", "lit/DDIA.epub", ["lit/DDIA.md"], "epub, opens in the reader"],
    ["an epub with no note", "lit/DDIA.epub", [], "epub, opens in a new tab"],
    ["an html page", "notes/page.html", [], "html, opens as a page"],
  ])("previews %s by where it opens, not by reading it", (_, path, vaultNotes, opens) => {
    fetchNote.mockClear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const finder = renderFinder(PATHS, undefined, { files: [path], vaultNotes });

    finder.type(path);

    expect(finder.highlighted()).toMatch(new RegExp(`^${path}`));
    expect(finder.preview()).toBe(opens);
    // Past the preview's delay, so a read of the file would have begun.
    act(() => vi.advanceTimersByTime(1_000));
    vi.useRealTimers();
    expect(fetchNote).not.toHaveBeenCalled();
  });
});

describe("the note finder's preview", () => {
  beforeEach(() => page.viewport(1440, 900));

  afterEach(() => {
    vi.useRealTimers();
    fetchNote.mockClear();
  });

  const pane = () => document.querySelector('[data-testid="preview"]');

  it("renders the highlighted note's markdown rather than its syntax", async () => {
    fetchNote.mockResolvedValueOnce("# a note\n\nwith **bold** in it");
    const finder = renderFinder();

    await vi.waitFor(() => expect(finder.preview()).toContain("with bold in it"));
    expect(fetchNote).toHaveBeenCalledWith(PATHS[0]);
    expect(finder.preview()).not.toContain("#");
    expect(finder.preview()).not.toContain("**");
    expect(pane()?.querySelector(".cm-strong")).toHaveTextContent("bold");
  });

  it("says it is reading the note until the read comes back", async () => {
    let answer: (text: string) => void = () => {};
    fetchNote.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const finder = renderFinder();

    // Before the delay the query is pending too, so wait for the read itself.
    await vi.waitFor(() => expect(fetchNote).toHaveBeenCalledTimes(1));
    expect(finder.preview()).toBe("reading the note");
    answer("# a note");
    await vi.waitFor(() => expect(finder.preview()).toBe("a note"));
  });

  it("says so when the note cannot be read, and still opens it on Enter", async () => {
    fetchNote.mockRejectedValueOnce(new Error("GET /api/files/x failed with 500"));
    const finder = renderFinder();

    await vi.waitFor(() => expect(finder.preview()).toBe("could not read this note"));
    expect(finder.rows()).toEqual(PATHS);
    finder.press("Enter");
    expect(finder.onOpen).toHaveBeenCalledWith(PATHS[0]);
  });

  it("reads one note when the highlight is walked and brought back", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const finder = renderFinder();

    // A held key repeats faster than the preview's delay.
    for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"]) {
      finder.press(key);
      act(() => vi.advanceTimersByTime(50));
    }
    act(() => vi.advanceTimersByTime(1_000));
    expect(fetchNote).toHaveBeenCalledTimes(1);
    expect(fetchNote).toHaveBeenCalledWith(PATHS[0]);
  });

  it("shows a note the cache already holds without reading it", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["note", PATHS[0]], "# already open");
    const finder = renderFinder(PATHS, queryClient);

    await vi.waitFor(() => expect(finder.preview()).toBe("already open"));
    expect(fetchNote).not.toHaveBeenCalled();
  });

  it("shows an empty pane for an empty note rather than the reading message", async () => {
    fetchNote.mockResolvedValueOnce("");
    const finder = renderFinder();

    await vi.waitFor(() => expect(fetchNote).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(finder.preview()).toBe(""));
  });

  it("shows no pane when nothing is highlighted", () => {
    const finder = renderFinder();

    finder.type("zzz");

    expect(pane()).toBeNull();
    expect(fetchNote).not.toHaveBeenCalled();
  });

  it("reads and draws no preview in a narrow window", async () => {
    await page.viewport(375, 812);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const finder = renderFinder();

    expect(finder.highlighted()).toBe(PATHS[0]);
    act(() => vi.advanceTimersByTime(1_000));
    expect(pane()).toBeNull();
    expect(fetchNote).not.toHaveBeenCalled();
  });
});
