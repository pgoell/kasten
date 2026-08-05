/**
 * What one keystroke in the note prompt costs end to end, in a real browser.
 *
 * The node gate in `tests/perf/ranking.test.ts` times the ranking alone, which
 * is the part a regression is easiest to pin on. This file times the whole
 * keystroke: the ranking, the verdict, React's reconciliation and the DOM
 * commit. jsdom cannot answer this question at all, because it lays nothing out
 * and paints nothing, so a number out of it would not be true.
 *
 * The design target is 16ms end to end, one frame, about 4ms of it JS. The
 * threshold below is not that target. It is a regression gate set far above
 * today's cost, so a change of the wrong order turns red and ordinary runner
 * noise does not. Slice 11 retightens it against whatever slices 5 and 6 reach.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { NotePrompt } from "@/components/note-prompt";
import { syntheticVault } from "../../bench/fixtures";

// Six times the 16.8ms synchronous median `mise run fe:frame` recorded at
// 78c7851 on this machine. Six rather than three because the gate runs on
// ubuntu-latest, and that runner is about 2.0x slower than this machine, so
// three times a local median would leave only 1.5x of headroom where it
// actually gates. The gate is on the synchronous half alone: the two-rAF
// window cannot resolve in under two refresh periods, so it reads about 33ms
// however cheap the keystroke is and steps to about 50ms the moment the work
// overruns its frame. A threshold between those steps flips on one dropped
// frame rather than on a regression, and on the slower runner it would sit
// past the step and be red today.
const COMMIT_LIMIT_MS = 100;

/** Untimed keystrokes, so the first timed one pays no warm-up cost. */
const WARMUPS = 3;

/**
 * One distinct character per run, warmups included, and one character rather
 * than a growing query so every run ranks a comparable share of the vault. A
 * repeat would put back the value the input already holds, React would bail out
 * of the render, and the run would time an empty frame.
 */
const KEYS = "abcdefghijklmnopqr";

/** Options currently mounted in the prompt's listbox. */
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
   * little the keystroke costs. So it says which step the keystroke landed on,
   * not what it cost to get there.
   */
  cost: number;
  /**
   * Median of the synchronous half alone: ranking, the verdict, reconciliation
   * and the DOM commit, with no waiting for the screen. This is the gated
   * number. It moves with the work rather than in refresh-period steps, and it
   * is what decides whether the frame drops.
   */
  commit: number;
  /** Options mounted on open, where the query is empty and every folder matches. */
  onOpen: number;
  /** Distinct option counts seen across the runs. One of them means nothing re-ranked. */
  counts: Set<number>;
}

async function measure(noteCount: number): Promise<Measurement> {
  const { paths } = syntheticVault(noteCount);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  root.render(
    // Not optional scaffolding: NotePrompt asks for the query client on every
    // render, so without a provider it throws on mount.
    <QueryClientProvider client={new QueryClient()}>
      <NotePrompt paths={paths} startPath="" onOpen={() => {}} onClose={() => {}} />
    </QueryClientProvider>,
  );

  // The first render is scheduled rather than synchronous, and none of it
  // belongs in the timed runs. Waiting on a row rather than on the input waits
  // for the whole first commit, list included.
  while (optionCount() === 0) await frame();

  const input = document.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (!input) throw new Error("the prompt mounted without its input");

  const onOpen = optionCount();
  const times: number[] = [];
  const commits: number[] = [];
  const counts = new Set<number>();

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
    if (index >= WARMUPS) {
      times.push(elapsed);
      commits.push(commit);
    }
  }

  root.unmount();
  container.remove();
  return { cost: median(times), commit: median(commits), onOpen, counts };
}

describe("one keystroke in the note prompt", () => {
  // The default five seconds does not cover eighteen keystrokes over a vault
  // this size, and the point of the slice is the number, not a fast run.
  it("commits within six times its recorded cost at 10,000 notes", async () => {
    const { cost, commit, onOpen, counts } = await measure(10000);

    console.log(
      `10,000 notes: ${cost.toFixed(1)}ms median keystroke, ${commit.toFixed(1)}ms of it before the paint`,
    );
    console.log(`10,000 notes: ${onOpen} options on open, ${[...counts].join("/")} while typing`);
    // Eighteen different queries producing one option count would mean the
    // keystrokes never reached the component, and the medians above would
    // belong to a render that did nothing.
    expect(counts.size).toBeGreaterThan(1);
    expect(commit).toBeLessThan(COMMIT_LIMIT_MS);
  }, 120_000);

  it("records what it costs at 50,000 notes", async () => {
    const { cost, commit, onOpen, counts } = await measure(50000);

    console.log(
      `50,000 notes: ${cost.toFixed(1)}ms median keystroke, ${commit.toFixed(1)}ms of it before the paint`,
    );
    console.log(`50,000 notes: ${onOpen} options on open, ${[...counts].join("/")} while typing`);
  }, 600_000);
});
