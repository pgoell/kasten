/**
 * Pictures of the weight kind that keeps its last value (#805) to look at by eye: the log
 * card and the log pane with a fixture of water, coffee, tea and weight, at a phone and a
 * desktop. Each picture is its own test, run alone with `-t "shot <name>"` and
 * VITE_KASTEN_SHOTS=1, and lands in node_modules/.cache/kasten-shots. The
 * `shot main ...` tests take the same pictures in the main worktree, where the weight
 * line is broken, to compare.
 */

import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/food-api";
import { logCard } from "@/lib/log-card";
import { periodicNote } from "@/lib/periodic";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import { notePath } from "@/lib/todo/todo-commands";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { wait } from "./sheet-fixture";
import "@/styles/app.css";

// Relative to this file, which vite's `server.fs` lets the browser write under; a folder outside
// the project is refused, so the pictures are moved out of here afterwards.
const DIR = "../../node_modules/.cache/kasten-shots";
const LOG_CONFIG = "99 Misc/01 Config/log.md";
const DAILY = periodicNote("daily", new Date()).path;
const REDUCED = "(prefers-reduced-motion: reduce)";

const CONFIG = [
  "---",
  "type: Config",
  "---",
  "- 💧 water: 250 ml, min 2000",
  "- ☕ coffee: 1, max 4",
  "- 🍵 tea: 1 cup, min 3",
  "- ⚖ weight: kg, last, max 85",
].join("\n");

// The day's log as the card and the pane read it: water, coffee, tea and lunch, no weigh-in
// today, so the weight button shows the latest one with its date.
const NOTE_BODY = [
  "# Today",
  "",
  "## Log",
  "- 💧 1500 ml",
  "- ☕ 3",
  "- 🍵 1 cup",
  "- 🍽 breakfast: Oats 🔥 320 kcal 🥩 12 g 🍞 54 g 🧈 6 g",
  "- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g",
  "",
  "## Done",
].join("\n");
const DAILY_TEXT = ["---", "type: Periodic Note", "---", "", NOTE_BODY].join("\n");

// Set by a test before it mounts. The pane and the card read thirty days from the same fixture.
const state = vi.hoisted(() => ({ fixture: true, over: false }));

// The same config with the weight's max at 83, so the early weigh-ins pass it.
const CONFIG_OVER = CONFIG.replace("max 85", "max 83");

/** The weigh-in on the range's index: 84.0 on the first day, 82.4 on the 28th. Twenty of thirty days have one. */
const weighIn = (index: number): number => Math.round((84 - (1.6 * index) / 28) * 10) / 10;

const dayOf = (index: number, date: string): LogDay => {
  const weigh = index % 3 !== 2;
  const entries: LogDay["entries"] = [
    {
      line: 12,
      text: "- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g",
      kind: "food",
      meal: "lunch",
      words: "Skyr",
      kcal: 160,
      protein: 27,
    },
  ];
  const mine: LogDay["totals"]["mine"] = [{ mark: "🍵", name: "tea", unit: "cup", total: 1 }];
  if (weigh) {
    const value = weighIn(index);
    entries.push({
      line: 13,
      text: `- ⚖ ${value} kg`,
      kind: "mine",
      mark: "⚖",
      name: "weight",
      amount: value,
      unit: "kg",
    });
    mine.push({ mark: "⚖", name: "weight", unit: "kg", total: value });
  }
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries,
    totals: {
      water: { ml: 1500 },
      coffee: { count: 3 },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: { kcal: 1800, protein: 90, carbs: 200, fat: 60 },
      mine,
    },
  };
};

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  const fetchNote = async (path: string) => {
    if (path === LOG_CONFIG) return state.over ? CONFIG_OVER : CONFIG;
    if (path === DAILY) return DAILY_TEXT;
    throw new real.NoteMissing(path);
  };
  return {
    ...real,
    fetchFiles: async () => ["index.md", DAILY],
    fetchNote,
    saveNote: async (path: string, content: string) => ({ path, content }),
    updateNote: async (path: string, change: (text: string) => string | null) => {
      const next = change(await fetchNote(path));
      return next === null ? null : { path, content: next };
    },
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTodos: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/food-api")>()),
  fetchLog: async (from: string, to: string): Promise<LogDay[]> => {
    if (!state.fixture) return [];
    const days: LogDay[] = [];
    for (let index = 0; ; index += 1) {
      const date = shiftDay(from, index);
      if (date > to) break;
      days.push(dayOf(index, date));
    }
    return days;
  },
}));

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

let root: Root | undefined;
let host: HTMLElement | undefined;
let card: EditorView | undefined;
let box: HTMLElement | undefined;

/** The theme and the palette, stored the way the app stores a pick, and applied. */
function setLook(theme: Theme, palette = "poel"): void {
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, palette);
  applyTheme();
}

/** The note with its card drawn, in a box of this size. */
async function mountCard(width: number, height: number): Promise<EditorView> {
  await page.viewport(width, height);
  box = document.body.appendChild(document.createElement("div"));
  box.className = "bg-k-bg";
  box.style.cssText = `position: relative; overflow: hidden; width: ${width}px; height: ${height}px;`;
  card = new EditorView({
    state: EditorState.create({
      doc: NOTE_BODY,
      extensions: [notePath.of(DAILY), logCard, EditorView.lineWrapping],
    }),
    parent: box,
  });
  await expect.poll(() => card?.dom.querySelector(".cm-log button")).not.toBeNull();
  return card;
}

/** The note in the app's route, at a page of this size. */
async function mountRoute(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  vi.stubGlobal("EventSource", SilentEventSource);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [`/?note=${encodeURIComponent(DAILY)}`] }),
  });
  await act(async () => {
    await router.load();
  });
  host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
  await expect.poll(() => document.querySelector(".cm-content")).not.toBeNull();
}

/** A finger's tap, as a touch sends it. */
function tap(element: HTMLElement | null): void {
  expect(element, "a control to tap").not.toBeNull();
  element?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  element?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  element?.click();
}

/** A key going down or up on an element, as a keyboard sends it. */
async function press(target: Element, key: string, type = "keydown"): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  });
}

const pane = () => document.querySelector<HTMLElement>("section[aria-label='Log']");

/** The card's element, or a failure where the note draws none. */
function cardOf(view: EditorView): HTMLElement {
  const element = view.dom.querySelector<HTMLElement>(".cm-log");
  if (!element) throw new Error("the note draws no log card");
  return element;
}

/** Screenshot `element` as `name`.png into DIR and answer the picture's width in pixels, as the shared helper does. */
async function shot(element: Element, name: string): Promise<number> {
  // A picture taken before the web font swaps in shows the fallback face.
  element.getBoundingClientRect();
  await document.fonts.ready;
  const png = import.meta.env.VITE_KASTEN_SHOTS
    ? (await page.screenshot({ element, path: `${DIR}/${name}.png`, base64: true })).base64
    : await page.screenshot({ element, save: false });
  // A PNG opens with its 8-byte signature and then the IHDR chunk, whose data
  // starts with the width as a big-endian uint32 at byte 16.
  const bytes = atob(png.slice(0, 32));
  return new DataView(Uint8Array.from(bytes, (c) => c.charCodeAt(0)).buffer).getUint32(16);
}

/** The card at a phone's size, by touch, in the theme asked for. */
async function phoneCard(
  theme: Theme = "light",
  motion: "reduce" | "no-preference" = "no-preference",
) {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true, [REDUCED]: motion === "reduce" });
  await commands.emulateMedia({ touch: true, reducedMotion: motion });
  setLook(theme);
  return mountCard(390, 844);
}

/** The pane at a phone's size, by touch, opened from the toolbar's log button. */
async function phonePane(): Promise<HTMLElement> {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  await commands.emulateMedia({ touch: true, reducedMotion: "no-preference" });
  setLook("light");
  await mountRoute(390, 844);
  await expect
    .poll(() => document.querySelector("button[aria-label='Open the log']"))
    .not.toBeNull();
  tap(document.querySelector<HTMLElement>("button[aria-label='Open the log']"));
  await expect.poll(pane).not.toBeNull();
  await wait(500);
  return pane() as HTMLElement;
}

/** The pane at a desktop's size, opened by `<leader>gf` with vim on, in the look asked for. */
async function desktopPane(theme: Theme, palette = "poel"): Promise<HTMLElement> {
  localStorage.setItem("kasten.vim", "on");
  setLook(theme, palette);
  await mountRoute(1440, 900);
  await expect
    .poll(() => document.querySelector(".cm-scroller.cm-vimMode .cm-content"))
    .not.toBeNull();
  const editor = document.querySelector(".cm-scroller.cm-vimMode .cm-content") as HTMLElement;
  for (const key of [" ", "g", "f"]) {
    await press(editor, key);
    await press(editor, key, "keyup");
  }
  await expect.poll(pane).not.toBeNull();
  await wait(500);
  return pane() as HTMLElement;
}

/** The card's Log weight button. */
function weightOf(view: EditorView): HTMLButtonElement | null {
  return view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log weight']");
}

/** Presses the card's weight button with the amount field empty, and waits for the question to show. */
async function askWeight(view: EditorView): Promise<void> {
  await expect.poll(() => weightOf(view)).not.toBeNull();
  tap(weightOf(view));
  await expect
    .poll(() => view.dom.querySelector(".cm-log-why")?.textContent ?? "")
    .toContain("Type the weight in kg");
}

afterEach(async () => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  card?.destroy();
  box?.remove();
  card = undefined;
  box = undefined;
  state.fixture = true;
  state.over = false;
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-palette");
  vi.unstubAllGlobals();
  await commands.emulateMedia({});
  await page.viewport(414, 896);
});

beforeEach(() => {
  localStorage.clear();
});

it("shot phone-card-weight", async () => {
  const view = await phoneCard();
  await expect.poll(() => weightOf(view)).not.toBeNull();
  expect(await shot(cardOf(view), "phone-card-weight")).toBeGreaterThan(0);
});

it("shot phone-card-ask", async () => {
  const view = await phoneCard();
  await askWeight(view);
  expect(await shot(cardOf(view), "phone-card-ask")).toBeGreaterThan(0);
});

it("shot phone-pane-today-weight", async () => {
  const panel = await phonePane();
  panel.querySelector<HTMLElement>("li[data-kind='weight']")?.scrollIntoView({ block: "center" });
  await wait(200);
  expect(await shot(panel, "phone-pane-today-weight")).toBe(390);
});

it("shot phone-pane-trends-weight-30d", async () => {
  const panel = await phonePane();
  const tab = [...panel.querySelectorAll<HTMLButtonElement>("[role='tab']")].find(
    (one) => one.textContent === "Trends",
  );
  tap(tab ?? null);
  await expect.poll(() => panel.querySelector("svg[aria-label^='weight over']")).not.toBeNull();
  panel
    .querySelector<HTMLElement>("svg[aria-label^='weight over']")
    ?.closest("figure")
    ?.scrollIntoView({ block: "center" });
  await wait(200);
  expect(await shot(panel, "phone-pane-trends-weight-30d")).toBe(390);
});

it("shot desktop-card-light", async () => {
  setLook("light");
  const view = await mountCard(1440, 900);
  await expect.poll(() => weightOf(view)).not.toBeNull();
  expect(await shot(box as HTMLElement, "desktop-card-light")).toBe(1440);
});

it("shot desktop-pane-light", async () => {
  state.fixture = true;
  const panel = await desktopPane("light");
  expect(await shot(panel, "desktop-pane-light")).toBeGreaterThan(0);
});

it("shot desktop-pane-dark", async () => {
  const panel = await desktopPane("dark");
  expect(await shot(panel, "desktop-pane-dark")).toBeGreaterThan(0);
});

it("shot palette-russet", async () => {
  const panel = await desktopPane("light", "russet");
  scrollToWeight(panel);
  await wait(200);
  expect(await shot(panel, "palette-russet")).toBeGreaterThan(0);
});

it("shot palette-peach", async () => {
  const panel = await desktopPane("light", "peach");
  scrollToWeight(panel);
  await wait(200);
  expect(await shot(panel, "palette-peach")).toBeGreaterThan(0);
});

it("shot palette-pansy", async () => {
  const panel = await desktopPane("dark", "pansy");
  scrollToWeight(panel);
  await wait(200);
  expect(await shot(panel, "palette-pansy")).toBeGreaterThan(0);
});

it("shot desktop-pane-trends-weight-over", async () => {
  state.over = true;
  const panel = await desktopPane("light");
  scrollToWeight(panel);
  await wait(200);
  expect(await shot(panel, "desktop-pane-trends-weight-over")).toBeGreaterThan(0);
});

it("shot phone-card-ask-dark", async () => {
  const view = await phoneCard("dark");
  await askWeight(view);
  expect(await shot(cardOf(view), "phone-card-ask-dark")).toBeGreaterThan(0);
});

it("shot phone-card-no-weigh-ins", async () => {
  state.fixture = false;
  const view = await phoneCard();
  await expect.poll(() => weightOf(view)?.textContent ?? "").toContain("no weigh-ins yet");
  expect(await shot(cardOf(view), "phone-card-no-weigh-ins")).toBeGreaterThan(0);
});

it("shot desktop-reduced-motion-ask", async () => {
  stubMatchMedia({ [REDUCED]: true });
  await commands.emulateMedia({ reducedMotion: "reduce" });
  setLook("light");
  const view = await mountCard(1440, 900);
  await askWeight(view);
  expect(await shot(box as HTMLElement, "desktop-reduced-motion-ask")).toBe(1440);
});

/** Scrolls the Trends column so the weight line, with its dots, average and goal, is at the top of the picture. */
function scrollToWeight(panel: HTMLElement): void {
  panel
    .querySelector<HTMLElement>("svg[aria-label^='weight over']")
    ?.closest("figure")
    ?.scrollIntoView({ block: "start" });
}

it("shot desktop-pane-trends-weight-light", async () => {
  const panel = await desktopPane("light");
  scrollToWeight(panel);
  await wait(200);
  expect(await shot(panel, "desktop-pane-trends-weight-light")).toBeGreaterThan(0);
});

it("shot desktop-pane-trends-weight-dark", async () => {
  const panel = await desktopPane("dark");
  scrollToWeight(panel);
  await wait(200);
  expect(await shot(panel, "desktop-pane-trends-weight-dark")).toBeGreaterThan(0);
});

// The same pictures in the main worktree, where the config's weight line is broken, so
// the card and the pane have no weight. Named apart, so `-t "shot desktop-card-light"` does
// not match them.
it("shot main desktop-card-light", async () => {
  setLook("light");
  const view = await mountCard(1440, 900);
  await expect.poll(() => view.dom.querySelector(".cm-log")).not.toBeNull();
  expect(await shot(box as HTMLElement, "desktop-card-light-main")).toBe(1440);
});

it("shot main desktop-pane-light", async () => {
  const panel = await desktopPane("light");
  expect(await shot(panel, "desktop-pane-light-main")).toBeGreaterThan(0);
});
