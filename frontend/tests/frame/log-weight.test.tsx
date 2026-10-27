/**
 * The weight kind that keeps its last value in a real browser (#805): the log card's
 * Weight button by touch at a phone and by keys at a desktop, the question it asks for a
 * number when the field is empty, Enter in the field, undo with vim on and off, and the
 * log pane's weight row and line. The desktop tests reach the pane through the route, as
 * a reader does, so the editor, vim and the pane are the app's own.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/log/food-api";
import { logCard } from "@/lib/log/log-card";
import { periodicNote } from "@/lib/periodic";
import { notePath } from "@/lib/todo/todo-commands";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import "@/styles/app.css";

const LOG_CONFIG = "99 Misc/01 Config/log.md";
const DAILY = periodicNote("daily", new Date()).path;
const REDUCED = "(prefers-reduced-motion: reduce)";

const CONFIG = [
  "---",
  "type: Config",
  "---",
  "- 💧 water: 250 ml, min 2000",
  "- ⚖ weight: kg, last",
].join("\n");

// The card's note: a Log heading with nothing under it, so the card is drawn over it.
const NOTE = ["# 2026-10-20 Tuesday", "", "## Log", "", "## Done"].join("\n");
const DAILY_TEXT = [
  "---",
  "type: Periodic Note",
  "---",
  "",
  "# Today",
  "",
  "## Log",
  "",
  "## Done",
].join("\n");

// Set by a test before it mounts: the pane's thirty days of weigh-ins, which the
// other tests do not have, so the card's latest value stays empty for them.
const state = vi.hoisted(() => ({ history: false }));

/** The weigh-in on a day of the range: 84.0 on the first, 82.4 on the 29th, never on every third day. */
const weighIn = (index: number): number => Math.round((84 - (1.6 * index) / 28) * 10) / 10;

const dayOf = (index: number, date: string): LogDay => {
  const weight = weighIn(index);
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries: [
      {
        line: 8,
        text: `- ⚖ ${weight} kg`,
        kind: "mine",
        mark: "⚖",
        name: "weight",
        amount: weight,
        unit: "kg",
      },
    ],
    totals: {
      water: { ml: 0 },
      coffee: { count: 0 },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      mine: [{ mark: "⚖", name: "weight", unit: "kg", total: weight }],
    },
  };
};

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  const fetchNote = async (path: string) => {
    if (path === LOG_CONFIG) return CONFIG;
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

vi.mock("@/lib/log/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log/food-api")>()),
  // Every third day in a range has no weigh-in; the range's first day is index 0.
  fetchLog: async (from: string, to: string): Promise<LogDay[]> => {
    if (!state.history) return [];
    const days: LogDay[] = [];
    for (let index = 0; ; index += 1) {
      const date = shiftDay(from, index);
      if (date > to) break;
      if (index % 3 !== 2) days.push(dayOf(index, date));
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

interface Mounted {
  host: HTMLElement;
  view: EditorView;
}

let live: Mounted | undefined;
let root: Root | undefined;
let host: HTMLElement | undefined;

/** The note with its card drawn, in a box of this size. */
async function mountCard(width: number, height: number): Promise<EditorView> {
  await page.viewport(width, height);
  const box = document.body.appendChild(document.createElement("div"));
  box.className = "bg-k-bg";
  box.style.cssText = `position: relative; overflow: hidden; width: ${width}px; height: ${height}px;`;
  const view = new EditorView({
    state: EditorState.create({
      doc: NOTE,
      extensions: [notePath.of(DAILY), logCard, EditorView.lineWrapping],
    }),
    parent: box,
  });
  live = { host: box, view };
  await expect.poll(() => view.dom.querySelector(".cm-log")).not.toBeNull();
  return view;
}

/** The note in the app's route, with the editor, vim and the log pane as a reader gets them. */
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

/** The phone's touch and reduced motion, as the existing frame tests emulate them. */
async function phone(motion: "reduce" | "no-preference" = "no-preference"): Promise<void> {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true, [REDUCED]: motion === "reduce" });
  await commands.emulateMedia({ touch: true, reducedMotion: motion });
}

/** A finger's tap: the pointer and mouse events before the click, as a touch sends them. */
function tap(element: HTMLElement | null): void {
  expect(element, "a control to tap").not.toBeNull();
  element?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  element?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  element?.click();
}

/** A key going down or up on an element, as a keyboard sends it. */
async function press(
  target: Element,
  key: string,
  type = "keydown",
  init: KeyboardEventInit = {},
): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

/** The card's Log weight button, or null while the config does not make one. */
function weightOf(view: EditorView): HTMLButtonElement | null {
  return view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log weight']");
}

/** The card's amount field, or a failure where the card draws none. */
function amountOf(view: EditorView): HTMLInputElement {
  const field = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
  expect(field, "the card's amount field").not.toBeNull();
  return field as HTMLInputElement;
}

/** The question the card shows under its row: the words of the ask, or nothing. */
function whyOf(view: EditorView): string {
  return view.dom.querySelector(".cm-log-why")?.textContent ?? "";
}

/** The note's editor in the route, which holds the card and the document. */
function routeView(): EditorView {
  const view = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(".cm-editor") as HTMLElement,
  );
  expect(view, "the note's editor").not.toBeNull();
  return view as EditorView;
}

const pane = () => document.querySelector<HTMLElement>("section[aria-label='Log']");
const today = () => pane()?.querySelector<HTMLElement>("section[aria-label='Today']");
const trends = () => pane()?.querySelector<HTMLElement>("section[aria-label='Trends']");

/** The pane at a desktop's size, opened by `<leader>gf` with vim on. */
async function openDesktop(): Promise<void> {
  localStorage.setItem("kasten.vim", "on");
  await mountRoute(1440, 900);
  // Only vim reads Space as the leader, and it marks the editor once it is up.
  await expect
    .poll(() => document.querySelector(".cm-scroller.cm-vimMode .cm-content"))
    .not.toBeNull();
  const editor = document.querySelector(".cm-scroller.cm-vimMode .cm-content") as HTMLElement;
  for (const key of [" ", "g", "f"]) {
    await press(editor, key);
    await press(editor, key, "keyup");
  }
  await expect.poll(pane).not.toBeNull();
}

/**
 * The empty tap asks for the number: the why line shows, the field takes the focus and
 * nothing is written. Then the number in the field, tapped again, is written as its line.
 */
async function askThenWrite(motion: "reduce" | "no-preference"): Promise<void> {
  await phone(motion);
  const view = await mountCard(390, 844);
  await expect.poll(() => weightOf(view)).not.toBeNull();
  const before = view.state.doc.toString();

  tap(weightOf(view));
  expect(whyOf(view), "the why line").toContain("Type the weight in kg");
  expect(amountOf(view).placeholder).toContain("kg");
  await expect.poll(() => document.activeElement).toBe(amountOf(view));
  expect(view.state.doc.toString(), "nothing written by the ask").toBe(before);

  amountOf(view).value = "81.9";
  tap(weightOf(view));
  expect(view.state.doc.toString()).toContain("- ⚖ 81.9 kg");
}

afterEach(async () => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  live?.view.destroy();
  live?.host.remove();
  live = undefined;
  state.history = false;
  localStorage.clear();
  vi.unstubAllGlobals();
  await commands.emulateMedia({});
  await page.viewport(414, 896);
});

beforeEach(() => {
  localStorage.clear();
});

it("#805 A14 at 390x844 by touch a typed kg amount is written and the button shows it", async () => {
  await phone();
  const view = await mountCard(390, 844);
  await expect.poll(() => weightOf(view)).not.toBeNull();

  amountOf(view).value = "82.4";
  tap(weightOf(view));
  expect(view.state.doc.toString()).toContain("- ⚖ 82.4 kg");
  await expect.poll(() => weightOf(view)?.textContent ?? "").toContain("82.4 kg");
});

it("#805 A14 at 390x844 by touch an empty tap asks for the kg and the next tap writes it", async () => {
  await askThenWrite("no-preference");
});

it("#805 A14 at 1440x900 with vim on Enter writes the asked kg line and vim u takes it back", async () => {
  localStorage.setItem("kasten.vim", "on");
  await mountRoute(1440, 900);
  await expect.poll(() => document.querySelector(".cm-scroller.cm-vimMode")).not.toBeNull();
  const view = routeView();
  await expect.poll(() => weightOf(view)).not.toBeNull();

  // The question comes first: Enter writes only a line the card asked a number for.
  tap(weightOf(view));
  const field = amountOf(view);
  field.focus();
  field.value = "82,4";
  await press(field, "Enter");
  // The line keeps the comma the reader typed; the parsers read it as the point.
  expect(view.state.doc.toString()).toContain("- ⚖ 82,4 kg");

  const content = view.contentDOM;
  content.focus();
  await press(content, "Escape");
  await press(content, "u");
  expect(view.state.doc.toString()).not.toContain("- ⚖ 82,4 kg");
});

it("#805 A14 at 1440x900 with vim off Enter writes the asked kg line and control z takes it back", async () => {
  localStorage.setItem("kasten.vim", "off");
  await mountRoute(1440, 900);
  await expect.poll(() => document.querySelector(".cm-content")).not.toBeNull();
  const view = routeView();
  await expect.poll(() => weightOf(view)).not.toBeNull();

  tap(weightOf(view));
  const field = amountOf(view);
  field.focus();
  field.value = "82,4";
  await press(field, "Enter");
  expect(view.state.doc.toString()).toContain("- ⚖ 82,4 kg");

  const content = view.contentDOM;
  content.focus();
  await press(content, "z", "keydown", { ctrlKey: true });
  expect(view.state.doc.toString()).not.toContain("- ⚖ 82,4 kg");
});

it("#805 A14 at 1440x900 the log pane shows the weight row in Today and a dot per weigh-in in Trends", async () => {
  state.history = true;
  await openDesktop();

  // Thirty days with a weigh-in on two in every three: twenty dots and one average line.
  await expect
    .poll(() => trends()?.querySelectorAll(".log-weight-dot").length ?? 0, { timeout: 3000 })
    .toBe(20);
  expect(trends()?.querySelector(".log-weight-avg"), "the 7-day average line").not.toBeNull();

  // The last weigh-in is 82.4, on the day before today, so the row shows it with its date.
  await expect
    .poll(() => today()?.querySelector<HTMLElement>("li[data-kind='weight']")?.textContent ?? "")
    .toContain("82.4 kg");
});

it("#805 A14 with reduced motion the empty tap still asks for the kg", async () => {
  await askThenWrite("reduce");
});
