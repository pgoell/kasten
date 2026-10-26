/**
 * The shared rig of the periodic review frame tests (#807): the current year's note and the
 * current week's note, the reads the vault would answer for them, a fetch stub that answers the
 * two review reads and records every request, and the helpers that mount a note and find what
 * the review drew. The `vi.mock` calls stay in each test file, since vitest hoists them there.
 */

import "@/styles/app.css";
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Mock } from "vitest";
import { commands, page } from "vitest/browser";
import { type LineHit, NoteMissing, type TodoHit } from "@/lib/api";
import { readClock, shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/food-api";
import { periodicNote } from "@/lib/periodic";
import { startPress } from "@/lib/press";
import type { WrittenNote } from "@/lib/review-year";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import {
  fontsIn,
  type Mounted,
  need,
  nextFrame,
  PATIENCE,
  type Size,
  scrollerOf,
  visibleEditor,
} from "./reader-fixture";

export const REDUCED = "(prefers-reduced-motion: reduce)";
export const VIM = "kasten.vim";

// The notes are the current year's and the current week's, so the review draws the period
// the clock is in. The review's own rules name them, so the paths come from the app's helpers.
// VITE_KASTEN_TODAY (a YYYY-MM-DD day) stands in for the clock's day, only so a run can show
// the week tests hold whichever weekday they run on (#1096).
const DAY = import.meta.env.VITE_KASTEN_TODAY;
const NOW = DAY ? new Date(`${DAY}T12:00:00`) : new Date();
export const YEAR = NOW.getFullYear();
export const YEAR_PATH = periodicNote("yearly", NOW).path;
const WEEK_PATH = periodicNote("weekly", NOW).path;
export const YEAR_ROUTE = `/?note=${encodeURIComponent(YEAR_PATH)}`;
export const WEEK_ROUTE = `/?note=${encodeURIComponent(WEEK_PATH)}`;

// The week runs Monday to Sunday, so the Monday is the day that many days back from today.
const monday = shiftDay(readClock(NOW).date, -((NOW.getDay() + 6) % 7));
export const SUNDAY = shiftDay(monday, 6);

const CONFIG_PATH = "99 Misc/01 Config/log.md";
export const TASKS = "02 Projects/FDE/tasks.md";
// The user's own line sits right under the title, so the cursor's first step down lands on it.
const YEAR_TEXT = `# ${YEAR}\nmy own line\n`;
const WEEK_TEXT = "# Week\nmy own line\n";
const CONFIG = "- 🍽 food: kcal max 2200\n- 💧 water: 250 ml\n- ⚖ weight: kg, last\n";
const TASKS_TEXT = [
  "# tasks",
  "",
  `- [x] ship the export ✅ ${shiftDay(monday, 1)}`,
  `- [x] write the spec ✅ ${YEAR}-02-11 ⏱ 45m`,
  "- [ ] next thing",
  "",
].join("\n");

const TEXTS: Record<string, string> = {
  [CONFIG_PATH]: CONFIG,
  [YEAR_PATH]: YEAR_TEXT,
  [WEEK_PATH]: WEEK_TEXT,
  [TASKS]: TASKS_TEXT,
};

// Two done todos in the week, one done in the year, and one open todo due in the week.
const TODOS: TodoHit[] = [
  {
    path: TASKS,
    line: 3,
    text: `- [x] ship the export ✅ ${shiftDay(monday, 1)} ⏱ 1h30m`,
    project: "02 Projects/FDE",
  },
  {
    path: TASKS,
    line: 4,
    text: `- [x] write the spec ✅ ${YEAR}-02-11 ⏱ 45m`,
    project: "02 Projects/FDE",
  },
  {
    path: "00 Inbox/tasks.md",
    line: 7,
    text: `- [x] reply to Anna ✅ ${shiftDay(monday, 2)} ⏱ 10m`,
    project: null,
  },
  {
    path: "00 Inbox/tasks.md",
    line: 8,
    text: `- [ ] send the deck 📅 ${shiftDay(monday, 3)}`,
    project: null,
  },
];

const CARDS: LineHit[] = [
  { path: "00 Inbox/cards.md", line: 1, text: "#flashcards/aws" },
  { path: "00 Inbox/cards.md", line: 2, text: `Q :: A <!--SR:!${shiftDay(monday, 1)},3,270-->` },
];

const NOTES: WrittenNote[] = [
  {
    path: "02 Projects/FDE/a.md",
    day: `${YEAR}-01-05`,
    tags: ["work"],
    project: "02 Projects/FDE",
  },
  { path: "00 Inbox/c.md", day: `${YEAR}-02-11`, tags: ["fde"], project: null },
];

// GitHub's days: three in January and nineteen on the Sunday of this week.
const GITHUB_DAYS: Record<string, number> = { [`${YEAR}-01-05`]: 3, [SUNDAY]: 19 };

/** One logged day with a kcal line, and a weigh-in when one is given. */
function logged(date: string, kcal: number, weight?: number): LogDay {
  const mine =
    weight === undefined ? [] : [{ mark: "⚖", name: "weight", unit: "kg", total: weight }];
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries: [{ line: 1, text: "- 🍽 lunch", kind: "food", kcal }],
    totals: {
      water: { ml: 0 },
      coffee: { count: 0 },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: { kcal, protein: 0, carbs: 0, fat: 0 },
      mine,
    },
  } as unknown as LogDay;
}

const LOGS = [
  logged(`${YEAR}-01-05`, 2000, 82.4),
  logged(shiftDay(monday, -1), 2100, 81),
  logged(shiftDay(monday, 1), 2300),
  logged(shiftDay(monday, 2), 1800, 80.2),
];

/** The reads the review makes through the api and food modules, as the test files mock them. */
export interface ReadMocks {
  fetchFiles: Mock;
  fetchNote: Mock;
  fetchTodos: Mock;
  fetchCards: Mock;
  fetchWritten: Mock;
  fetchLog: Mock;
  saveNote: Mock;
  updateNote: Mock;
}

/** Gives each read its answer for this file's vault: the notes, the todos, the cards and the log. */
export function installReads(mocks: ReadMocks): void {
  mocks.fetchFiles.mockImplementation(async () => Object.keys(TEXTS));
  mocks.fetchNote.mockImplementation(async (path: string) => {
    const text = TEXTS[path];
    if (text === undefined) throw new NoteMissing(path);
    return text;
  });
  mocks.fetchTodos.mockImplementation(async () => TODOS);
  mocks.fetchCards.mockImplementation(async () => CARDS);
  mocks.fetchWritten.mockImplementation(async () => [`${YEAR}-01-05`, `${YEAR}-02-11`]);
  mocks.fetchLog.mockImplementation(async (from: string, to: string) =>
    LOGS.filter((day) => day.date >= from && day.date <= to),
  );
}

/** The text of the last save of the note, which the editor writes after an edit. */
export function lastSaved(saveNote: Mock): string {
  return (saveNote.mock.calls.at(-1)?.[1] as string | undefined) ?? "";
}

/** A stream that never says anything, so the route opens no connection. */
export class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

/** Every request the page makes, as its method and path. A write shows as a method other than GET. */
let requests: string[] = [];

/** The review's two reads answered, and any other request a 404. Each request is recorded. */
function answer(input: RequestInfo | URL, init?: RequestInit): Response {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
  if (url.pathname === "/api/written/notes") return Response.json(NOTES);
  if (url.pathname === "/api/github") return Response.json({ on: true, days: GITHUB_DAYS });
  return new Response("not in this test", { status: 404 });
}

/** Stubs `fetch` with the answers above and starts a fresh request record. */
export function stubReviewFetch(): void {
  requests = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
    answer(input, init),
  );
}

/** The requests that wrote something. */
export const writes = () => requests.filter((request) => !request.startsWith("GET "));

/**
 * Mounts the route at one size, with vim as `storage` says and the motion asked for, and waits
 * for the editor's text. The reader fixture's own mount fixes the motion at no preference, so
 * the reduced-motion test needs its own mount.
 */
export async function mountAt(
  size: Size,
  route: string,
  storage: Record<string, string>,
  motion: "reduce" | "no-preference",
): Promise<Mounted> {
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({ touch: size.coarse, reducedMotion: motion });
  stubMatchMedia({
    [NARROW]: size.width < 768,
    [COARSE]: size.coarse,
    [REDUCED]: motion === "reduce",
  });
  localStorage.clear();
  localStorage.setItem(VIM, "on");
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
  document.documentElement.dataset.theme = "light";

  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [route] }),
  });
  await act(async () => {
    await router.load();
  });
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
  await expect.poll(() => host.querySelector("[data-reader-grid]"), PATIENCE).not.toBeNull();
  await expect
    .poll(() => host.querySelector(".cm-content")?.textContent ?? "", PATIENCE)
    .not.toBe("");
  await fontsIn();
  return { host, root, stop: startPress() };
}

/** The review block the note has drawn, once its title is on screen. */
export async function drawn(host: HTMLElement, title: string): Promise<HTMLElement> {
  await expect
    .poll(() => host.querySelector(".cm-review")?.textContent ?? "", PATIENCE)
    .toContain(title);
  return need(host.querySelector<HTMLElement>(".cm-review"), "the review block");
}

/** The editor view of the note on screen. */
export function viewOf(host: HTMLElement): EditorView {
  const editor = need(visibleEditor(host).closest<HTMLElement>(".cm-editor"), "editor element");
  return need(EditorView.findFromDOM(editor), "editor view");
}

/** The text the editor on screen holds, which is the note's own text. */
export function textOf(host: HTMLElement): string {
  return viewOf(host).state.doc.toString();
}

/** The text of the line the cursor is on. */
export function cursorLine(host: HTMLElement): string {
  const view = viewOf(host);
  return view.state.doc.lineAt(view.state.selection.main.head).text;
}

/** The line of the editor on screen with this text, or undefined while it is not drawn. */
export function lineNamed(host: HTMLElement, text: string): HTMLElement | undefined {
  return [...visibleEditor(host).querySelectorAll<HTMLElement>(".cm-line")].find(
    (line) => line.textContent === text,
  );
}

/** Whether the line with this text is drawn inside the editor's box on screen. */
export function inView(host: HTMLElement, text: string): boolean {
  const line = lineNamed(host, text);
  if (!line) return false;
  const box = line.getBoundingClientRect();
  const pane = scrollerOf(host).getBoundingClientRect();
  return box.top >= pane.top && box.bottom <= pane.bottom;
}

/**
 * Scrolls the line into the middle of the screen, as a reader does before a tap. The block is
 * taller than the phone and the desktop screen, so the user's line starts below the fold, and
 * a click there would land on nothing.
 */
export async function reveal(host: HTMLElement, text: string): Promise<void> {
  need(lineNamed(host, text), `the line ${text}`).scrollIntoView({ block: "center" });
  await nextFrame();
  await nextFrame();
}

/** The row of the review whose text holds `words`. */
export function rowNamed(host: HTMLElement, words: string): HTMLElement {
  const row = [...host.querySelectorAll<HTMLElement>(".review-row")].find((each) =>
    (each.textContent ?? "").includes(words),
  );
  return need(row, `a review row with ${words}`);
}

/** A finger's tap: the pointer and mouse events before the click, as a touch sends them. */
export async function tap(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    element.click();
  });
}

/** The state each frame test leaves behind: the media, the globals and the viewport. */
export async function restoreFrame(): Promise<void> {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  await commands.emulateMedia({});
  await page.viewport(1280, 900);
}
