import { history } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type Food, fetchLog, type LogDay, readBarcode, searchFood } from "@/lib/food-api";
import { logCard } from "@/lib/log-card";
import { fetchMyFoods } from "@/lib/my-foods";
import { notePath } from "@/lib/todo-commands";
import { vimModeField, vimModeState } from "@/lib/vim-mode";
import { stubMatchMedia } from "./match-media";

const camera = vi.hoisted(() => ({ stop: vi.fn() }));

vi.mock("@/lib/food-api", () => ({
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
  fetchLog: vi.fn(),
}));
vi.mock("@/lib/my-foods", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/my-foods")>()),
  fetchMyFoods: vi.fn(),
  addMyFood: vi.fn(),
}));
vi.mock("@/lib/barcode-camera", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/barcode-camera")>()),
  startCamera: vi.fn(() => camera.stop),
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";
const SHEET = "[role='dialog'][aria-label='Food search']";

const SNICKERS: Food = {
  code: "5000159461122",
  name: "Snickers",
  brand: null,
  serving_g: 50,
  serving_from: "serving_quantity",
  per_100g: { kcal: 481, protein: 8.6, carbs: 60.5, fat: 22.5 },
  per_serving: { kcal: 240, protein: 4.3, carbs: 30.2, fat: 11.2 },
};

const mounted: EditorView[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 20, 12, 30));
  vi.mocked(searchFood)
    .mockReset()
    .mockResolvedValue([{ ...SNICKERS, serving_g: 100 }]);
  vi.mocked(readBarcode).mockReset().mockResolvedValue(SNICKERS);
  vi.mocked(fetchLog)
    .mockReset()
    .mockResolvedValue([] as LogDay[]);
  vi.mocked(fetchMyFoods).mockReset().mockResolvedValue({ foods: [], broken: [] });
  camera.stop.mockReset();
});

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
  Reflect.deleteProperty(navigator, "mediaDevices");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A view on `doc` with the card and `extra`, the cursor at the start. */
function mount(doc: string, extra: Extension[] = []): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [notePath.of(DAILY), history(), logCard, ...extra],
    }),
    parent,
  });
  mounted.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const queryOf = (view: EditorView) =>
  view.dom.querySelector<HTMLInputElement>(".cm-log-food-query");

/** Presses the card's 🍽 button, and lets the card draw the sheet it opens. */
async function openFood(view: EditorView): Promise<void> {
  view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log food']")?.click();
  await vi.advanceTimersByTimeAsync(0);
}

/** Types into the search, and lets the pause pass so the search is sent. */
async function typeQuery(view: EditorView, value: string): Promise<void> {
  fireEvent.input(queryOf(view) as HTMLInputElement, { target: { value } });
  await vi.advanceTimersByTimeAsync(400);
}

/** The sheet that holds the food search, wherever it is drawn. */
function sheetOf(view: EditorView): HTMLElement | null {
  return view.dom.querySelector<HTMLElement>(SHEET);
}

it("#803 A9 on a desktop the food search opens as the right panel with a scrim", async () => {
  const view = mount(NOTE);
  await openFood(view);
  const sheet = sheetOf(view);
  expect(sheet).not.toBeNull();
  expect(sheet?.className).toContain("w-[540px]");
  const scrim = sheet?.previousElementSibling as HTMLElement;
  expect(scrim.className).toContain("absolute inset-0");
  expect(scrim.className).toContain("bg-black/30");
});

it("#803 A9 on a phone the food search opens as the bottom sheet with a grabber", async () => {
  stubMatchMedia({ "(width < 48rem)": true });
  const view = mount(NOTE);
  await openFood(view);
  const sheet = sheetOf(view);
  expect(sheet).not.toBeNull();
  expect(sheet?.className).toContain("inset-x-0 bottom-0");
  expect(sheet?.querySelector("[data-sheet-drag]")).not.toBeNull();
});

it("#803 A9 Esc in the search field closes the sheet and writes nothing", async () => {
  const view = mount(NOTE);
  await openFood(view);
  expect(sheetOf(view)).not.toBeNull();
  await typeQuery(view, "snickers");
  fireEvent.keyDown(queryOf(view) as HTMLInputElement, { key: "Escape" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(sheetOf(view)).toBeNull();
  expect(text(view)).toBe(NOTE);
});

it("#803 I7 closing by the scrim stops the camera and gives the editor the focus", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  const view = mount(NOTE);
  await openFood(view);
  expect(sheetOf(view)).not.toBeNull();
  view.dom.querySelector<HTMLButtonElement>(".cm-log-food-scan")?.click();
  const scrim = sheetOf(view)?.previousElementSibling as HTMLElement;
  scrim.click();
  await vi.advanceTimersByTimeAsync(1000);
  expect(camera.stop).toHaveBeenCalled();
  expect(document.activeElement).toBe(view.contentDOM);
});

it("#803 I7 with vim on, after Log this food the editor has the focus in normal mode and u takes the line back", async () => {
  const view = mount(NOTE, [vim(), vimModeState()]);
  await openFood(view);
  expect(sheetOf(view)).not.toBeNull();
  await typeQuery(view, "snickers");
  view.dom.querySelector<HTMLButtonElement>(".cm-log-food-results button")?.click();
  await vi.advanceTimersByTimeAsync(0);
  view.dom.querySelector<HTMLButtonElement>("button[aria-label='Log this food']")?.click();
  // The card takes the sheet down in a microtask after the line is written.
  await vi.advanceTimersByTimeAsync(0);
  expect(text(view)).not.toBe(NOTE);
  expect(document.activeElement).toBe(view.contentDOM);
  expect(view.state.field(vimModeField)).toBe("normal");
  fireEvent.keyDown(view.contentDOM, { key: "u" });
  expect(text(view)).toBe(NOTE);
});

it("#803 I8 a drink tap while the sheet is open keeps its query and focus", async () => {
  const view = mount(NOTE);
  await openFood(view);
  expect(sheetOf(view)).not.toBeNull();
  await typeQuery(view, "snickers");
  const panel = view.dom.querySelector(".cm-log-food");
  const query = queryOf(view);
  view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log water']")?.click();
  expect(text(view)).toContain("- 💧 250 ml");
  expect(view.dom.querySelector(".cm-log-food")).toBe(panel);
  expect(queryOf(view)).toBe(query);
  expect(query?.value).toBe("snickers");
  expect(document.activeElement).toBe(query);
});

it("#803 I8 a view destroyed after the sheet opened leaves no host behind", async () => {
  const view = mount(NOTE);
  await openFood(view);
  expect(sheetOf(view)).not.toBeNull();
  // Taken out of the afterEach's list, since this test destroys the view itself.
  mounted.splice(mounted.indexOf(view), 1);
  view.destroy();
  await Promise.resolve();
  expect(document.querySelector(".cm-log-food-host")).toBeNull();
  view.dom.parentElement?.remove();
});
