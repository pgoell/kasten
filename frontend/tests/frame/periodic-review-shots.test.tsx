/**
 * Pictures of the periodic reviews (#807) to look at by eye: the year review on the yearly note
 * and the week review on the weekly one, a phone at 390 by 844 by touch and a desktop at 1440 by
 * 900 with a mouse, in both themes, with GitHub on and off, the other palettes and reduced motion.
 * Each picture is its own test, run alone with `-t "shot <name>"`, and lands in
 * node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1. Without it the tests are skipped.
 */

import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { type LineHit, NoteMissing, type TodoHit } from "@/lib/api";
import { readClock, shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/food-api";
import { periodicNote } from "@/lib/periodic";
import { startPress } from "@/lib/press";
import type { WrittenNote } from "@/lib/review-year";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import {
  DESKTOP,
  fontsIn,
  type Mounted,
  need,
  nextFrame,
  PATIENCE,
  type Size,
  scrollerOf,
  TOUCH,
  unmount,
  visibleEditor,
} from "./reader-fixture";
import { shot } from "./shots";
import "@/styles/app.css";

const REDUCED = "(prefers-reduced-motion: reduce)";
const VIM = "kasten.vim";
const DAY_MS = 86_400_000;

// The year and the week are the ones the clock is in, so the pictures show the current period.
const NOW = new Date();
const YEAR = NOW.getFullYear();
const TODAY = readClock(NOW).date;
const JAN1 = `${YEAR}-01-01`;
const DAYS_SO_FAR = Math.round(
  (Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${JAN1}T00:00:00Z`)) / DAY_MS,
);
const MONDAY = shiftDay(TODAY, -((NOW.getDay() + 6) % 7));
const YEAR_PATH = periodicNote("yearly", NOW).path;
const WEEK_PATH = periodicNote("weekly", NOW).path;
const YEAR_ROUTE = `/?note=${encodeURIComponent(YEAR_PATH)}`;
const WEEK_ROUTE = `/?note=${encodeURIComponent(WEEK_PATH)}`;

const CONFIG_PATH = "99 Misc/01 Config/log.md";
const PROJECTS = ["02 Projects/FDE", "02 Projects/Kasten", "02 Projects/Home"];

/** The day `k` of `n` steps across the year so far, so samples spread over the months. */
const spread = (k: number, n: number) => shiftDay(JAN1, Math.floor((k * DAYS_SO_FAR) / n));

/** Thirty-six todos done across the year, with time logged on most, over three projects. */
const DONE: TodoHit[] = Array.from({ length: 36 }, (_, k) => {
  const project = PROJECTS[k % 3] ?? null;
  const time = k % 4 === 3 ? "" : ` ⏱ ${15 + ((k * 37) % 120)}m`;
  return {
    path: `${project}/tasks.md`,
    line: k + 3,
    text: `- [x] task ${k} ✅ ${spread(k, 36)}${time}`,
    project,
  };
});

const WEEK_TODOS: TodoHit[] = [
  {
    path: `${PROJECTS[0]}/tasks.md`,
    line: 60,
    text: `- [x] ship the export ✅ ${shiftDay(MONDAY, 1)} ⏱ 1h30m`,
    project: PROJECTS[0] ?? null,
  },
  {
    path: `${PROJECTS[1]}/tasks.md`,
    line: 61,
    text: `- [x] reply to Anna ✅ ${shiftDay(MONDAY, 2)} ⏱ 10m`,
    project: PROJECTS[1] ?? null,
  },
  {
    path: `${PROJECTS[2]}/tasks.md`,
    line: 62,
    text: `- [x] fix the boiler ✅ ${shiftDay(MONDAY, 4)}`,
    project: PROJECTS[2] ?? null,
  },
  {
    path: "00 Inbox/tasks.md",
    line: 63,
    text: `- [ ] send the deck 📅 ${shiftDay(MONDAY, 2)}`,
    project: null,
  },
  {
    path: "00 Inbox/tasks.md",
    line: 64,
    text: `- [ ] renew passport 📅 ${shiftDay(TODAY, 9)}`,
    project: null,
  },
];

const TODOS = [...DONE, ...WEEK_TODOS];

// Each deck's cards, one rated on most days of the year, spread over the week and beyond.
const CARDS: LineHit[] = [
  { path: "01 Flashcards/aws.md", line: 1, text: "#flashcards/aws" },
  ...Array.from({ length: 30 }, (_, k) => ({
    path: "01 Flashcards/aws.md",
    line: k + 2,
    text: `What is item ${k}?::An answer <!--SR:!${shiftDay(TODAY, (k % 7) - 3)},${3 + (k % 4)},250-->`,
  })),
  { path: "01 Flashcards/geography.md", line: 1, text: "#flashcards/geography" },
  {
    path: "01 Flashcards/geography.md",
    line: 2,
    text: `The capital of {{c1::France}} is Paris. <!--SR:c1!${shiftDay(TODAY, 2)},2,250-->`,
  },
];

// Forty-eight notes over the year, some in a project folder and some tagged.
const TAGS = [["work"], ["reading"], ["fde", "work"], ["ideas"], ["travel"], []];
const NOTES: WrittenNote[] = Array.from({ length: 48 }, (_, k) => {
  const project = k % 4 === 0 ? (PROJECTS[k % 3] ?? null) : null;
  return {
    path: project ? `${project}/note-${k}.md` : `00 Inbox/note-${k}.md`,
    day: spread(k, 48),
    tags: TAGS[k % TAGS.length] ?? [],
    project,
  };
});

/** One logged day: food with its kcal, and a weigh-in on every third day, drifting down. */
function logOf(n: number): LogDay {
  const date = shiftDay(JAN1, n);
  const kcal = 1800 + ((n * 131) % 600);
  const weight = n % 3 === 0 ? Math.round((82.4 - n * 0.01 + ((n * 7) % 5) / 10) * 10) / 10 : null;
  const mine = weight === null ? [] : [{ mark: "⚖", name: "weight", unit: "kg", total: weight }];
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

// Every day so far is logged except every ninth, so the year has gaps.
const LOGS = Array.from({ length: DAYS_SO_FAR + 1 }, (_, n) => n)
  .filter((n) => n % 9 !== 4)
  .map(logOf);

// Last year's New Year's Eve is in the answer on purpose: a year caption that counts it shows 500 more.
const GITHUB_DAYS = {
  [shiftDay(JAN1, -1)]: 500,
  ...Object.fromEntries(
    Array.from({ length: DAYS_SO_FAR + 1 }, (_, n) => n)
      .filter((n) => (n * 17) % 11 < 7)
      .map((n) => [shiftDay(JAN1, n), ((n * 5) % 14) + 1]),
  ),
};

const CONFIG = [
  "---",
  "type: Config",
  "---",
  "- 💧 water: 250 ml, min 2000",
  "- ☕ coffee: 1, max 3",
  "- 🍽 food: kcal max 2200, protein min 120",
  "- ⚖ weight: kg, last",
].join("\n");

// The user's own words sit under the block, in the year and in the week, so the pictures show them.
const OWN = Array.from({ length: 24 }, (_, k) => `- my own line ${k + 1}, written by hand.`);
const YEAR_TEXT = [
  `# ${YEAR}`,
  "",
  `[[01 Periodic/04 Yearly/${YEAR - 1}]] | [[01 Periodic/04 Yearly/${YEAR + 1}]]`,
  "",
  "## My notes",
  ...OWN,
  "",
].join("\n");
const WEEK_TEXT = ["# Week", "", "## My notes", ...OWN, ""].join("\n");

const TEXTS: Record<string, string> = {
  [CONFIG_PATH]: CONFIG,
  [YEAR_PATH]: YEAR_TEXT,
  [WEEK_PATH]: WEEK_TEXT,
};

// The GitHub answer each picture asks for, set before the page mounts.
const flags = vi.hoisted(() => ({ github: true }));

const mocks = vi.hoisted(() => {
  const fetchNote = vi.fn();
  const saveNote = vi.fn(async (path: string, content: string) => ({ path, content }));
  return {
    fetchNote,
    saveNote,
    updateNote: vi.fn(async (path: string, change: (text: string) => string | null) => {
      const next = change((await fetchNote(path)) as string);
      return next === null ? null : saveNote(path, next);
    }),
    fetchFiles: vi.fn(),
    fetchTodos: vi.fn(),
    fetchCards: vi.fn(),
    fetchWritten: vi.fn(),
    fetchLog: vi.fn(),
  };
});

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchFiles: mocks.fetchFiles,
  fetchNote: mocks.fetchNote,
  saveNote: mocks.saveNote,
  updateNote: mocks.updateNote,
  fetchTodos: mocks.fetchTodos,
  fetchCards: mocks.fetchCards,
  fetchWritten: mocks.fetchWritten,
  searchNotes: async () => [],
  fetchImages: async () => [],
  fetchHtml: async () => [],
  fetchAssets: async () => [],
  fetchTags: async () => [],
  fetchTerminals: async () => [],
  fetchVersion: async () => "0.8.0",
  fetchWeather: async () => [],
}));

vi.mock("@/lib/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/food-api")>()),
  fetchLog: mocks.fetchLog,
}));

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

/** The review's two reads through `fetch`: the written notes and GitHub's days. */
function answer(input: RequestInfo | URL): Response {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  // As the backend answers: only the days of the range asked for.
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const inRange = (day: string) => day >= from && day <= to;
  if (url.pathname === "/api/written/notes") {
    return Response.json(NOTES.filter((note) => inRange(note.day)));
  }
  if (url.pathname === "/api/github") {
    const days = Object.fromEntries(Object.entries(GITHUB_DAYS).filter(([day]) => inRange(day)));
    return Response.json(flags.github ? { on: true, days } : { on: false, days: {} });
  }
  return new Response("not in this picture", { status: 404 });
}

/** The theme and the palette, stored the way the app stores a pick, and applied. */
function setLook(theme: Theme, palette: string): void {
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, palette);
  applyTheme();
}

interface Look {
  theme?: Theme;
  palette?: string;
  motion?: "reduce" | "no-preference";
  github?: boolean;
}

/**
 * Mounts the route at one size, in the look asked for, with vim off as a phone has it, and waits
 * for the review block and the text under it.
 */
async function mountLook(size: Size, route: string, look: Look = {}): Promise<Mounted> {
  const { theme = "light", palette = "poel", motion = "no-preference", github = true } = look;
  flags.github = github;
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({ touch: size.coarse, reducedMotion: motion });
  stubMatchMedia({
    [NARROW]: size.width < 768,
    [COARSE]: size.coarse,
    [REDUCED]: motion === "reduce",
  });
  localStorage.clear();
  localStorage.setItem(VIM, "off");
  setLook(theme, palette);

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
    .poll(() => host.querySelector(".cm-review")?.textContent ?? "", PATIENCE)
    .not.toBe("");
  await fontsIn();
  return { host, root, stop: startPress() };
}

/** The editor view of the note on screen. */
function viewOf(host: HTMLElement): EditorView {
  const editor = need(visibleEditor(host).closest<HTMLElement>(".cm-editor"), "editor element");
  return need(EditorView.findFromDOM(editor), "editor view");
}

/** Scrolls the note to the line of the user's own text, the way a reader scrolls down to it. */
async function scrollToOwnText(host: HTMLElement): Promise<void> {
  const line = [...visibleEditor(host).querySelectorAll<HTMLElement>(".cm-line")].find((each) =>
    (each.textContent ?? "").includes("my own line 1,"),
  );
  need(line, "the user's first line").scrollIntoView({ block: "start" });
  scrollerOf(host).scrollTop = Math.max(0, scrollerOf(host).scrollTop - 24);
  await nextFrame();
  await nextFrame();
  expect(viewOf(host).state.doc.toString()).toContain("my own line 1,");
}

/**
 * Waits for the block's title and its charts, so the picture never shows a block still
 * waiting on its reads, then two frames for the charts to lay out.
 */
async function drawnTitle(host: HTMLElement, title: string): Promise<void> {
  await expect
    .poll(() => host.querySelector(".cm-review")?.textContent ?? "", PATIENCE)
    .toContain(title);
  await expect
    .poll(() => host.querySelectorAll(".cm-review svg").length, PATIENCE)
    .toBeGreaterThan(0);
  await nextFrame();
  await nextFrame();
}

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => answer(input));
  mocks.fetchFiles.mockImplementation(async () => Object.keys(TEXTS));
  mocks.fetchNote.mockImplementation(async (path: string) => {
    const text = TEXTS[path];
    if (text === undefined) throw new NoteMissing(path);
    return text;
  });
  mocks.fetchTodos.mockImplementation(async () => TODOS);
  mocks.fetchCards.mockImplementation(async () => CARDS);
  mocks.fetchWritten.mockImplementation(async (from: string, to: string) =>
    [...new Set(NOTES.map((note) => note.day))].filter((day) => day >= from && day <= to),
  );
  mocks.fetchLog.mockImplementation(async (from: string, to: string) =>
    LOGS.filter((day) => day.date >= from && day.date <= to),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-palette");
  await commands.emulateMedia({});
  await page.viewport(1280, 900);
});

/** A picture test: skipped unless the shots are asked for, as overview-shots does. */
const picture = import.meta.env.VITE_KASTEN_SHOTS ? it : it.skip;

picture("shot phone-year-top", async () => {
  const mounted = await mountLook(TOUCH, YEAR_ROUTE);
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "phone-year-top")).toBe(390);
  } finally {
    await unmount(mounted);
  }
});

picture("shot phone-year-below", async () => {
  const mounted = await mountLook(TOUCH, YEAR_ROUTE);
  try {
    await drawnTitle(mounted.host, "Year in review");
    await scrollToOwnText(mounted.host);
    expect(await shot(mounted.host, "phone-year-below")).toBe(390);
  } finally {
    await unmount(mounted);
  }
});

picture("shot phone-week-top", async () => {
  const mounted = await mountLook(TOUCH, WEEK_ROUTE);
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "phone-week-top")).toBe(390);
  } finally {
    await unmount(mounted);
  }
});

picture("shot phone-week-below", async () => {
  const mounted = await mountLook(TOUCH, WEEK_ROUTE);
  try {
    await drawnTitle(mounted.host, "Week in review");
    await scrollToOwnText(mounted.host);
    expect(await shot(mounted.host, "phone-week-below")).toBe(390);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-year-light", async () => {
  const mounted = await mountLook(DESKTOP, YEAR_ROUTE);
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "desktop-year-light")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-year-dark", async () => {
  const mounted = await mountLook(DESKTOP, YEAR_ROUTE, { theme: "dark" });
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "desktop-year-dark")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-year-github-off", async () => {
  const mounted = await mountLook(DESKTOP, YEAR_ROUTE, { github: false });
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "desktop-year-github-off")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-week-light", async () => {
  const mounted = await mountLook(DESKTOP, WEEK_ROUTE);
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "desktop-week-light")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-week-dark", async () => {
  const mounted = await mountLook(DESKTOP, WEEK_ROUTE, { theme: "dark" });
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "desktop-week-dark")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-week-github-off", async () => {
  const mounted = await mountLook(DESKTOP, WEEK_ROUTE, { github: false });
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "desktop-week-github-off")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-year-russet", async () => {
  const mounted = await mountLook(DESKTOP, YEAR_ROUTE, { palette: "russet" });
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "desktop-year-russet")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-week-peach", async () => {
  const mounted = await mountLook(DESKTOP, WEEK_ROUTE, { palette: "peach" });
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "desktop-week-peach")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-year-pansy", async () => {
  const mounted = await mountLook(DESKTOP, YEAR_ROUTE, { palette: "pansy", theme: "dark" });
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "desktop-year-pansy")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-week-reduced-motion", async () => {
  const mounted = await mountLook(DESKTOP, WEEK_ROUTE, { motion: "reduce" });
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "desktop-week-reduced-motion")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});
