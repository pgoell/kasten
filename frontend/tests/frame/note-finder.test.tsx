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
 * threshold below is not that target. It is a regression gate set well above
 * what the keystroke costs today, so a change of the wrong order turns red and
 * ordinary runner noise does not.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { NoteFinder } from "@/components/note-finder";
import { syntheticVault } from "../../bench/fixtures";

// The preview reads a note when the highlight holds still, and a real request
// inside the timed window would be measuring the network. It never fires during
// a run, the delay outlasting the gap between keystrokes, but a stub is what
// makes that a fact rather than a hope.
vi.mock("@/lib/api", () => ({
  fetchNote: () => Promise.resolve(""),
  // Named because the module is replaced whole: the editor behind the preview
  // imports these, and a factory short of a name breaks the import itself.
  fetchImages: () => Promise.resolve([]),
  uploadAsset: () => Promise.resolve(),
}));

// Six times the 6.7ms synchronous median `mise run fe:frame` measures on this
// machine, three runs reading 7.1, 6.7 and 5.7ms. Six is two factors: three
// carries a real regression, and two carries the runner, which is about 2.0x
// slower than this machine, so three times a local median would leave only 1.5x
// of headroom where it actually gates.
//
// 6.7ms is inside the 16ms frame with room to spare, and it is the dearest
// keystroke of the lot: one letter, over every note in the vault. At 50,000
// notes the same keystroke reads about 21ms and does drop its frame, which the
// second case records and gates on nothing.
//
// The gate is on the synchronous half alone: the two-rAF window cannot resolve
// in under two refresh periods, so it reads about 33ms however cheap the
// keystroke is and steps to about 50ms the moment the work overruns its frame.
// A threshold between those steps flips on one dropped frame rather than on a
// regression, and on the slower runner it would sit past the step and be red
// today.
const COMMIT_LIMIT_MS = 40;

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
   * commit, with no waiting for the screen. This is the gated number. It moves
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

  for (const [index, key] of [...KEYS].entries()) {
    let commit = 0;
    const elapsed = await frameCost(() => {
      const start = performance.now();
      typeInto(input, key);
      // React flushes a change event synchronously, so by the time the dispatch
      // returns the new rows are already in the DOM and only the paint is left.
      commit = performance.now() - start;
    });
    counts.add(optionCount());
    tops.add(document.querySelector('[role="option"]')?.textContent ?? "");
    if (index >= WARMUPS) {
      times.push(elapsed);
      commits.push(commit);
    }
  }

  root.unmount();
  container.remove();
  return { cost: median(times), commit: median(commits), onOpen, counts, tops };
}

describe("one keystroke in the note finder", () => {
  // The default five seconds does not cover eighteen keystrokes over a vault
  // this size, and the point of the slice is the number, not a fast run.
  it("commits within six times its recorded cost at 10,000 notes", async () => {
    const { cost, commit, onOpen, counts, tops } = await measure(10000);

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
    // What the cap is for. Every one of the 10,000 notes matches an empty
    // query, and mounting a button for each would be most of the keystroke.
    expect(onOpen).toBeLessThanOrEqual(VISIBLE_NOTES);
    expect(Math.max(...counts)).toBeLessThanOrEqual(VISIBLE_NOTES);
    expect(commit).toBeLessThan(COMMIT_LIMIT_MS);
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
