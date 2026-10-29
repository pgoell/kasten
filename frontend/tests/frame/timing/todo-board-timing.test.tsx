/**
 * Frames while the todo board scrolls at a phone's width (#1321), measured before
 * any fix. The gate counts React commits and long tasks, not wall time, since the
 * box is loaded. The longest gap between frames is printed only.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Profiler } from "react";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { TodoPane } from "@/components/todo-pane";
import type { TodoHit } from "@/lib/api";
import { DEFAULT_VIEWS } from "@/lib/todo/todo-view";
import { COARSE, NARROW, stubMatchMedia } from "../../match-media";
import { stubCommands } from "../../stub-commands";
import "@/styles/app.css";

const { fetchTodos } = vi.hoisted(() => ({ fetchTodos: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchTodos,
  fetchNote: () => Promise.resolve(DEFAULT_VIEWS),
  fetchFiles: () => Promise.resolve([]),
  createNote: () => Promise.resolve(),
}));

const TODAY = "2026-10-29";
const PROJECTS = ["Kasten", "Haus", "FDE", "Garten"];
const OPEN = ["[ ]", "[/]", "[b]"];
const CLOSED = ["[x]", "[-]"];

/** The date `back` days before today, for a daily note. */
function dayBack(back: number): string {
  return new Date(Date.UTC(2026, 9, 29) - back * 864e5).toISOString().slice(0, 10);
}

/** The state mark of the `i`th line: 161 open, 8 review or waiting, the rest done or rejected. */
function stateOf(i: number): string {
  if (i < 161) return OPEN[i % 3] ?? "[ ]";
  if (i < 169) return i % 2 ? "[r]" : "[w]";
  return CLOSED[i % 2] ?? "[x]";
}

/**
 * 982 synthetic todo lines over 150 notes, 90 in project folders and 60 in daily
 * notes, at most 7 a note. No note text here is real.
 */
const HITS: TodoHit[] = Array.from({ length: 982 }, (_, i) => {
  const note = i % 150;
  const project = note < 90 ? `02 Projects/${PROJECTS[note % 4]}` : null;
  const path = project
    ? `${project}/note-${note}.md`
    : `01 Periodic/00 Daily/${dayBack(note - 90)}.md`;
  const date = i % 5 === 0 ? " 📅 2026-10-30" : "";
  const priority = i % 7 === 0 ? " ⏫" : "";
  const tag = i % 4 === 0 ? ` #p/${"xyz"[i % 3] ?? "x"}` : "";
  return {
    path,
    line: Math.floor(i / 150) + 1,
    text: `- ${stateOf(i)} task ${i}${date}${priority}${tag}`,
    project,
    shared: false,
  };
});

interface Tally {
  commits: number;
  tasks: number;
  taskMs: number;
}
const blank = (): Tally => ({ commits: 0, tasks: 0, taskMs: 0 });
let tally = blank();

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** A timer's wait, so the long tasks just before reach the observer, which is a task behind. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

/** Scrolls `box` to its end over `steps` frames, answering the longest gap between two of them. */
async function scrollBoard(box: HTMLElement, steps = 60): Promise<number> {
  const end = box.scrollHeight - box.clientHeight;
  let last = await nextFrame();
  let worst = 0;
  for (let step = 1; step <= steps; step++) {
    box.scrollTop = (end * step) / steps;
    const now = await nextFrame();
    worst = Math.max(worst, now - last);
    last = now;
  }
  return worst;
}

const COMMIT_BUDGET = 1;
const LONGTASK_BUDGET = 2;
const FIRST_COMMIT_BUDGET = 6;
const FIRST_LONGTASK_BUDGET = 3;

// Measured: first draw 54 cards, 4 commits, 1 long task (97 ms). Scroll of 2090 px
// in 60 frames: 0 commits, 0 long tasks, worst frame gap 16.8 ms (printed only).
// Budgets: scroll commits at most 1, long tasks at most 2, a little above the measured
// 0. They prove the scroll does no React work and no long task on this board, so a
// fix that adds a scroll listener or a re-render fails here. The first draw of
// 982 lines is held to 6 commits and 3 long tasks, the measured 4 and 1 with room
// for a loaded box: a draw that renders once per line fails it.
it("A3 #1321 draws and scrolls the todo board at phone width within its commit and long-task budget", async () => {
  fetchTodos.mockResolvedValue(HITS);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const observer = new PerformanceObserver((list) => {
    for (const task of list.getEntries()) {
      tally.tasks += 1;
      tally.taskMs += task.duration;
    }
  });
  // In a `finally`, so a failed run does not leave its viewport to the cases after it.
  try {
    await page.viewport(390, 844);
    stubMatchMedia({ [COARSE]: true, [NARROW]: true });
    host.style.cssText = "width: 100%; height: 844px; background: #282c34;";
    observer.observe({ type: "longtask", buffered: false });

    tally = blank();
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Profiler id="board" onRender={() => (tally.commits += 1)}>
          <TodoPane
            commands={stubCommands()}
            onOpen={() => {}}
            onCycle={() => {}}
            onAdd={() => {}}
            onSubtask={() => {}}
            onEdit={() => {}}
            onBlock={() => {}}
            onTimer={() => {}}
            onAgent={() => {}}
            onRefile={() => {}}
            onNotice={() => {}}
            focusSignal={0}
            today={TODAY}
            archive={false}
          />
        </Profiler>
      </QueryClientProvider>,
    );
    await expect.poll(() => host.querySelector("[data-row]")).not.toBeNull();
    // `c` turns the list into the board, as in the project lane test.
    host
      .querySelector("section[aria-label='Todos']")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    await expect.poll(() => host.querySelector("[data-testid='todo-card']")).not.toBeNull();
    await settle();
    const first = { ...tally };
    const cards = host.querySelectorAll("[data-testid='todo-card']").length;
    console.error(
      `TIMING todo-board first-draw hits=${HITS.length} cards=${cards} commits=${first.commits} longtasks=${first.tasks} longtask-ms=${first.taskMs.toFixed(1)}`,
    );

    const box = Array.from(host.querySelectorAll<HTMLElement>("*")).find(
      (el) =>
        el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY),
    );
    if (!box) throw new Error("the board draws no scrolling box at phone width");

    tally = blank();
    const worstGap = await scrollBoard(box);
    await settle();
    const scrolled = { ...tally };
    console.error(
      `TIMING todo-board scroll scroll-px=${box.scrollHeight - box.clientHeight} commits=${scrolled.commits} longtasks=${scrolled.tasks} longtask-ms=${scrolled.taskMs.toFixed(1)} worst-frame-gap-ms=${worstGap.toFixed(1)}`,
    );

    const breaches = [
      ...(first.commits > FIRST_COMMIT_BUDGET
        ? [`first-draw commits ${first.commits} > ${FIRST_COMMIT_BUDGET}`]
        : []),
      ...(first.tasks > FIRST_LONGTASK_BUDGET
        ? [`first-draw longtasks ${first.tasks} > ${FIRST_LONGTASK_BUDGET}`]
        : []),
      ...(scrolled.commits > COMMIT_BUDGET
        ? [`commits ${scrolled.commits} > ${COMMIT_BUDGET}`]
        : []),
      ...(scrolled.tasks > LONGTASK_BUDGET
        ? [`longtasks ${scrolled.tasks} > ${LONGTASK_BUDGET}`]
        : []),
    ];
    // The counts ride on the failure message too, so a breach shows what it measured.
    const timing = [
      `first-draw: cards=${cards} commits=${first.commits} longtasks=${first.tasks}`,
      `scroll: commits=${scrolled.commits} longtasks=${scrolled.tasks} longtask-ms=${scrolled.taskMs.toFixed(1)} worst-frame-gap-ms=${worstGap.toFixed(1)}`,
    ].join("\n");
    expect(breaches, timing).toEqual([]);
  } finally {
    observer.disconnect();
    root.unmount();
    host.remove();
    vi.unstubAllGlobals();
    await page.viewport(414, 896);
  }
});
