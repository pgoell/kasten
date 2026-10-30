/**
 * What a flashcard sitting costs at a phone's width (#1321): the React commits
 * and the long tasks while a 1500-card deck opens, and while 20 cards are graded.
 *
 * The gate counts work and never wall time, because a loaded box slows every
 * task at once and a count does not move with it. The frame gap is printed only.
 *
 * The note is synthetic, sized to the live deck's 1 MB: two thirds of its cards
 * carry a schedule, the rest are new.
 */

import { Parser } from "@lezer/common";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { ReviewSession } from "@/components/review-session";
import type { Deck } from "@/lib/review/review";
import "@/styles/app.css";

const CARDS = 1500;
const FILLER = "Synthetic filler for a timing fixture, not an answer anyone wrote. ".repeat(9);
const BIG = `#flashcards/big\n\n${Array.from({ length: CARDS }, (_, index) => {
  const n = index + 1;
  const schedule = n % 3 === 0 ? "" : " <!--SR:!2026-08-20,4,270-->";
  return `Question ${n}::Answer ${n}. ${FILLER}${schedule}`;
}).join("\n\n")}\n`;

const DECK: Deck = {
  name: "big",
  notes: ["decks/big.md"],
  due: 1000,
  fresh: 500,
  parked: 0,
  whole: false,
  next: null,
};

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchNote: (path: string) =>
    path === "decks/big.md"
      ? Promise.resolve(BIG)
      : Promise.reject(new Error(`GET /api/files/${path} failed with 404`)),
  saveNote: (path: string, content: string) => {
    saves += 1;
    return Promise.resolve({ path, content });
  },
  fetchReviewLimits: () => Promise.reject(new Error("GET /api/review/limits failed with 404")),
}));

let root: Root | undefined;
let host: HTMLElement | undefined;
let commits = 0;
let saves = 0;
let longTasks: PerformanceEntry[] = [];
let observer: PerformanceObserver | undefined;
let parse: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  localStorage.clear();
  commits = 0;
  saves = 0;
  longTasks = [];
  observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
  observer.observe({ type: "longtask" });
  parse = vi.spyOn(Parser.prototype, "parse");
  vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
  await page.viewport(390, 844);
  await commands.emulateMedia({ touch: true });
});

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  observer?.disconnect();
  observer = undefined;
  vi.restoreAllMocks();
  await commands.emulateMedia({});
  await page.viewport(414, 896);
});

/** Long tasks since the last call: how many, and their summed duration in ms. */
function takeLongTasks(): { count: number; ms: number } {
  longTasks.push(...(observer?.takeRecords() ?? []));
  const count = longTasks.length;
  const ms = Math.round(longTasks.reduce((sum, entry) => sum + entry.duration, 0));
  longTasks = [];
  return { count, ms };
}

/** The longest gap between animation frames, from now until the returned call. */
function trackFrames(): () => number {
  let last = performance.now();
  let worst = 0;
  let running = true;
  // performance.now(), not the frame's stamp: a stamp can sit before the call and skew the first gap.
  const tick = () => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    running = false;
    return Math.round(worst);
  };
}

/** Mounts the sitting on the deck, inside a profiler that counts each React commit. */
function mount(): HTMLElement {
  const div = document.body.appendChild(document.createElement("div"));
  div.className = "h-dvh w-full";
  host = div;
  root = createRoot(div);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <Profiler id="review" onRender={() => (commits += 1)}>
        <ReviewSession deck={DECK} onLeave={() => {}} />
      </Profiler>
    </QueryClientProvider>,
  );
  return div;
}

/** The lezer parses of the 1 MB deck on this thread; the card's editor parses only its own text. */
function mainParses(): number {
  return parse.mock.calls.filter(
    ([input]: unknown[]) => typeof input === "string" && input.length > 100_000,
  ).length;
}

/** Once `writes` saves have gone out and the page has been idle since, so a grade's tail is counted. */
async function settled(writes: number): Promise<void> {
  await expect.poll(() => saves).toBe(writes);
  for (let frame = 0; frame < 2; frame++) {
    await new Promise((wake) => requestAnimationFrame(wake));
  }
  await new Promise((wake) => requestIdleCallback(wake));
}

/** Turns the card and grades it good, until the `step`th write has landed. */
async function grade(screen: HTMLElement, step: number): Promise<void> {
  await reveal(screen);
  (screen.querySelector('button[data-rating="good"]') as HTMLButtonElement).click();
  await expect.poll(() => screen.querySelector('button[data-rating="good"]')).toBeNull();
  // The write lands after the buttons go, and its tail is this step's work, not the next's (#1380).
  await settled(step);
}

/** Shows the answer the way a click on the footer does. */
async function reveal(screen: HTMLElement): Promise<void> {
  (screen.querySelector("footer button") as HTMLButtonElement).click();
  await expect.poll(() => screen.querySelector('button[data-rating="good"]')).not.toBeNull();
}

// Budget: 6 commits and 3 long tasks. Measured 4 commits and 1 long task (71 ms) on
// the first open. The room over the measure absorbs a loaded box's extra task; a
// second commit per card on open would blow past it.
it("A4 #1321 opens a 1500-card deck at phone width within its commit and long-task budget", async () => {
  const frameGap = trackFrames();
  const screen = mount();
  await expect
    .poll(() => screen.querySelector('[data-testid="review-card"] .cm-line'), { timeout: 30_000 })
    .not.toBeNull();
  const tasks = takeLongTasks();
  console.error(
    `TIMING review open cards=${CARDS} commits=${commits} longtasks=${tasks.count} longtask-ms=${tasks.ms} frame-gap-max-ms=${frameGap()}`,
  );
  expect.soft(commits).toBeLessThanOrEqual(6);
  expect.soft(tasks.count).toBeLessThanOrEqual(3);
}, 60_000);

// A count, not the long task's ms: main parsed the deck here once, 51 ms at 1x and 141 ms at a
// 4x CPU slowdown, one long task each. The worker takes the parse off this thread (#1359).
it("A4 #1359 opens a 1500-card deck with no card parse on the main thread", async () => {
  const screen = mount();
  await expect
    .poll(() => screen.querySelector('[data-testid="review-card"] .cm-line'), { timeout: 30_000 })
    .not.toBeNull();
  expect(mainParses()).toBe(0);
}, 60_000);

// Budget: 88 commits and 3 long tasks over 20 steps, each step counted until its write has
// landed and the page is idle (#1380). Measured 80 commits (4 a step) and 0 long tasks at 1x.
// At a 4x CPU slowdown main had 40, two a step of the deck's two parses; now 20, one a step,
// mostly the write's sha256 of the 1 MB note. 88 leaves a commit of room every other step.
it("A4 #1321 steps through 20 cards at phone width within its commit and long-task budget", async () => {
  const screen = mount();
  await expect
    .poll(() => screen.querySelector('[data-testid="review-card"] .cm-line'), { timeout: 30_000 })
    .not.toBeNull();
  takeLongTasks();

  const frameGap = trackFrames();
  let totalCommits = 0;
  let totalLongTasks = 0;
  let worstStep = 0;
  for (let step = 1; step <= 20; step++) {
    const before = commits;
    const parsed = mainParses();
    takeLongTasks();
    await grade(screen, step);
    const made = commits - before;
    const tasks = takeLongTasks();
    totalCommits += made;
    totalLongTasks += tasks.count;
    worstStep = Math.max(worstStep, made);
    console.error(
      `TIMING review step=${step} commits=${made} parses=${mainParses() - parsed} longtasks=${tasks.count} longtask-ms=${tasks.ms}`,
    );
  }
  console.error(
    `TIMING review 20-steps commits=${totalCommits} longtasks=${totalLongTasks} worst-step-commits=${worstStep} frame-gap-max-ms=${frameGap()}`,
  );
  expect.soft(totalCommits).toBeLessThanOrEqual(88);
  expect.soft(totalLongTasks).toBeLessThanOrEqual(3);
}, 120_000);

// A count, not the long task's ms: main parsed the deck twice a grade, 40 parses over 20 grades
// and 40 long tasks at a 4x CPU slowdown. A grade shifts the cards it holds instead (#1379).
it("A4 #1379 grades 20 cards with no card parse on the main thread", async () => {
  const screen = mount();
  await expect
    .poll(() => screen.querySelector('[data-testid="review-card"] .cm-line'), { timeout: 30_000 })
    .not.toBeNull();
  const opened = mainParses();
  for (let step = 1; step <= 20; step++) await grade(screen, step);
  expect(mainParses() - opened).toBe(0);
}, 120_000);
