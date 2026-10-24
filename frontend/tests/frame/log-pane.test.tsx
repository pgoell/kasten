/**
 * The log pane in a real browser, at phone and at desktop width (#624).
 *
 * The pane is reached through the route, as a reader reaches it: the toolbar's
 * log button on a phone, and `<leader>gf` on a desktop. jsdom lays nothing out,
 * so only here can the touch targets be measured and the page checked for
 * sideways scroll. Pictures land in node_modules/.cache/kasten-shots with
 * VITE_KASTEN_SHOTS=1.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { page } from "vitest/browser";
import { shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/food-api";
import { periodicNote } from "@/lib/periodic";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { shot } from "./shots";
import "@/styles/app.css";

const LOG_CONFIG = "99 Misc/01 Config/log.md";
const DAILY = periodicNote("daily", new Date()).path;
const DAILY_TEXT = "---\ntype: Periodic Note\n---\n\n# Today\n\n## TODOs\n";

// The kinds the config names: a goal on each, and a kind of the user's own.
const CONFIG = [
  "---",
  "type: Config",
  "---",
  "- 💧 water: 250 ml, min 2000",
  "- ☕ coffee: 1, max 4",
  "- 🍺 alcohol: 1, max 2",
  "- 🍵 tea: 1 cup, min 3",
  "- 🍽 food: kcal max 2200, protein min 120",
].join("\n");

/** Every save the route made, in order, so a test can read what the vault was sent. */
const writes = vi.hoisted(() => ({ saved: [] as { path: string; content: string }[] }));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  const fetchNote = async (path: string) => {
    if (path === LOG_CONFIG) return CONFIG;
    if (path === DAILY) return DAILY_TEXT;
    throw new real.NoteMissing(path);
  };
  const saveNote = async (path: string, content: string) => {
    writes.saved.push({ path, content });
    return { path, content };
  };
  return {
    ...real,
    fetchFiles: async () => ["index.md", DAILY],
    fetchNote,
    saveNote,
    updateNote: async (path: string, change: (text: string) => string | null) => {
      const text = await fetchNote(path);
      const next = change(text);
      return next === null ? null : saveNote(path, next);
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

// Thirty days of the log, with the days at four fixed places left empty so the
// bars and the averages have gaps. Index 0 is the first day asked for, so a one
// day query is always a day with entries.
const EMPTY_DAYS = [4, 11, 19, 26];

const dayOf = (index: number, date: string): LogDay => {
  const water = 500 + ((index * 250) % 1500);
  const coffee = (index % 4) + 1;
  const alcohol = index % 6 === 5 ? 0 : 1;
  const entries: LogDay["entries"] = [
    { line: 8, text: `- 💧 ${water} ml`, kind: "water", ml: water },
    { line: 9, text: `- ☕ ${coffee}`, kind: "coffee", count: coffee },
    { line: 11, text: "- 🍵 1 cup", kind: "mine", mark: "🍵", name: "tea", amount: 1, unit: "cup" },
    {
      line: 12,
      text: "- 🍽 breakfast: Oats 🔥 320 kcal 🥩 12 g 🍞 54 g 🧈 6 g",
      kind: "food",
      meal: "breakfast",
      words: "Oats",
      kcal: 320,
      protein: 12,
      carbs: 54,
      fat: 6,
    },
    {
      line: 13,
      text: "- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g",
      kind: "food",
      meal: "lunch",
      words: "Skyr",
      kcal: 160,
      protein: 27,
    },
  ];
  if (alcohol === 1) {
    entries.splice(2, 0, {
      line: 10,
      text: "- 🍺 1 0.5 l 5%",
      kind: "alcohol",
      count: 1,
      ml: 500,
      abv: 5,
      grams: 19.7,
    });
  }
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries,
    totals: {
      water: { ml: water },
      coffee: { count: coffee },
      alcohol: { count: alcohol, ml: alcohol * 500, grams: alcohol * 19.7 },
      food: { kcal: 480, protein: 39, carbs: 54, fat: 6 },
      mine: [{ mark: "🍵", name: "tea", unit: "cup", total: 1 }],
    },
  };
};

vi.mock("@/lib/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/food-api")>()),
  fetchLog: async (from: string, to: string): Promise<LogDay[]> => {
    const days: LogDay[] = [];
    for (let index = 0; ; index += 1) {
      const date = shiftDay(from, index);
      if (date > to) break;
      if (!EMPTY_DAYS.includes(index)) days.push(dayOf(index, date));
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

async function mount(width: number, height: number): Promise<void> {
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

/**
 * A finger's tap: the pointer and mouse events before the click, as a touch sends
 * them. Dispatched inside `act`, so the pane has drawn what the tap did when this
 * returns, which React does not promise for an event sent from outside it.
 */
async function tap(element: HTMLElement | null): Promise<void> {
  expect(element, "a control to tap").not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    element?.click();
  });
}

/** A key going down or up on an element, as a keyboard sends it, drawn as `tap` is. */
async function press(target: Element, key: string, type = "keydown"): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  });
}

const pane = () => document.querySelector<HTMLElement>("section[aria-label='Log']");
const trends = () => pane()?.querySelector<HTMLElement>("section[aria-label='Trends']");

/** The pane's button with exactly this text, or null. */
function button(text: string): HTMLButtonElement | null {
  return (
    [...(pane()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (one) => one.textContent === text,
    ) ?? null
  );
}

/** The text the daily note was last saved with, or undefined where it was not. */
function savedToday(): string | undefined {
  return writes.saved.filter((write) => write.path === DAILY).pop()?.content;
}

/** The buttons of the pane that are drawn, and the ones under 44px in either side. */
function smallButtons(): string[] {
  return [...(pane()?.querySelectorAll<HTMLElement>("button") ?? [])]
    .filter((one) => one.getClientRects().length > 0)
    .map((one) => ({ one, box: one.getBoundingClientRect() }))
    .filter(({ box }) => box.height < 44 || box.width < 44)
    .map(({ one, box }) => `${one.textContent} ${Math.round(box.width)}x${Math.round(box.height)}`);
}

afterEach(async () => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
  await page.viewport(414, 896);
});

beforeEach(() => {
  localStorage.clear();
  writes.saved.length = 0;
});

it("#624 the log pane at 414 by touch", async () => {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  await mount(414, 896);
  await expect
    .poll(() => document.querySelector("button[aria-label='Open the log']"))
    .not.toBeNull();
  await tap(document.querySelector<HTMLElement>("button[aria-label='Open the log']"));
  await expect.poll(pane).not.toBeNull();

  expect(smallButtons()).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(414);
  expect(await shot(pane() as HTMLElement, "log-pane-today-414")).toBe(414);

  await tap(pane()?.querySelector<HTMLButtonElement>("button[aria-label='Log water']") ?? null);
  await expect.poll(savedToday).toContain("- 💧 250 ml");

  await tap(pane()?.querySelector<HTMLElement>(".log-pane-line") ?? null);
  expect(pane()?.querySelector(".log-pane-edit")).not.toBeNull();
  expect(await shot(pane() as HTMLElement, "log-pane-edit-414")).toBe(414);

  await tap(button("30d"));
  trends()?.scrollIntoView({ block: "start" });
  // The whole pane, since the Trends section sits inside its gutter and is narrower than the phone.
  expect(await shot(pane() as HTMLElement, "log-pane-trends-414")).toBe(414);
});

it("#624 the log pane on a desktop", async () => {
  // Pinned on, so the test does not depend on the browser's pointer, which picks vim by default.
  localStorage.setItem("kasten.vim", "on");
  await mount(1200, 900);
  // Only vim reads Space as the leader, and it marks the editor once it is up.
  await expect
    .poll(() => document.querySelector(".cm-scroller.cm-vimMode .cm-content"))
    .not.toBeNull();
  const editor = document.querySelector(".cm-scroller.cm-vimMode .cm-content") as HTMLElement;
  // The leader is space and then the keys after it, each released before the next.
  for (const key of [" ", "g", "f"]) {
    await press(editor, key);
    await press(editor, key, "keyup");
  }
  await expect.poll(pane).not.toBeNull();
  const panel = pane() as HTMLElement;
  panel.focus();

  expect(smallButtons()).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1200);
  // The pane sits beside the tree, so its picture is the pane's own width, not the window's.
  expect(await shot(panel, "log-pane-today-1200")).toBe(panel.clientWidth);

  await press(panel, "j");
  const rows = () => [...panel.querySelectorAll<HTMLElement>(".log-pane-row-item")];
  expect(rows()[1]?.classList.contains("log-pane-selected")).toBe(true);
  await press(panel, "e");
  expect(panel.querySelector(".log-pane-edit")).not.toBeNull();
  expect(await shot(panel, "log-pane-edit-1200")).toBe(panel.clientWidth);

  await press(panel.querySelector(".log-pane-edit input") as HTMLElement, "Escape");
  expect(panel.querySelector(".log-pane-edit")).toBeNull();

  await press(panel, "7");
  expect(button("7d")?.getAttribute("aria-pressed")).toBe("true");
  await press(panel, "3");
  expect(button("30d")?.getAttribute("aria-pressed")).toBe("true");
  trends()?.scrollIntoView({ block: "start" });
  expect(await shot(panel, "log-pane-trends-1200")).toBe(panel.clientWidth);
});
