/**
 * The food search's sheet in a real browser at a phone, opened the way a reader
 * opens it: the card's 🍽 button. The drag is pointer events, as a finger sends
 * them; the foot is read off the DOM, so the numbers are the ones on screen.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { commands, page } from "vitest/browser";
import { type Food, fetchLog, readBarcode, searchFood } from "@/lib/food-api";
import { logCard } from "@/lib/log-card";
import { fetchMyFoods } from "@/lib/my-foods";
import { notePath } from "@/lib/todo-commands";
import "@/styles/app.css";
import { centreOf, nextFrame, pointer, wait } from "./sheet-fixture";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote: vi.fn(() => Promise.reject(new Error("no config in this frame"))),
}));
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

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";

const SNICKERS: Food = {
  code: "5000159461122",
  name: "Snickers",
  brand: null,
  serving_g: 50,
  serving_from: "serving_quantity",
  per_100g: { kcal: 481, protein: 8.6, carbs: 60.5, fat: 22.5 },
  per_serving: { kcal: 240, protein: 4.3, carbs: 30.2, fat: 11.2 },
};

let host: HTMLDivElement;
let view: EditorView;

beforeEach(async () => {
  await page.viewport(390, 844);
  vi.mocked(searchFood)
    .mockReset()
    .mockResolvedValue([{ ...SNICKERS, serving_g: 100 }]);
  vi.mocked(readBarcode).mockReset().mockResolvedValue(SNICKERS);
  vi.mocked(fetchLog).mockReset().mockResolvedValue([]);
  vi.mocked(fetchMyFoods).mockReset().mockResolvedValue({ foods: [], broken: [] });
  host = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({
      doc: NOTE,
      extensions: [notePath.of(DAILY), logCard],
    }),
    parent: host,
  });
});

afterEach(async () => {
  view.destroy();
  host.remove();
  await commands.emulateMedia({});
});

/** The food search's sheet, or null where it is not drawn. */
function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[role='dialog'][aria-label='Food search']");
}

/** Presses the card's 🍽 button, which opens the sheet. */
function openFood(): void {
  view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log food']")?.click();
}

it("#803 A9 at 390x844 a drag down on the grabber closes the food sheet", async () => {
  openFood();
  await wait(500);
  const sheet = dialog() as HTMLElement;
  expect(sheet).not.toBeNull();
  const grab = sheet.querySelector<HTMLElement>("[data-sheet-drag]") as HTMLElement;
  const start = centreOf(grab);
  // Past the whole sheet, so the release is a close whatever the speed.
  const far = start.y + sheet.offsetHeight + 40;

  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointermove", start.x, start.y + 20);
  pointer(grab, "pointermove", start.x, far);
  pointer(grab, "pointerup", start.x, far);

  await expect.poll(() => dialog(), { timeout: 3000 }).toBeNull();
});

it("#803 A14 at 390x844 the preview and Log this food stay pinned at the foot while the sheet scrolls", async () => {
  openFood();
  await wait(500);
  expect(dialog()).not.toBeNull();
  const query = view.dom.querySelector<HTMLInputElement>(".cm-log-food-query") as HTMLInputElement;
  query.value = "snickers";
  query.dispatchEvent(new Event("input"));
  await wait(500);
  view.dom.querySelector<HTMLButtonElement>(".cm-log-food-results button")?.click();
  await wait(50);

  // A stand-in above the form makes the sheet taller than its screen, so it scrolls.
  const panel = view.dom.querySelector<HTMLElement>(".cm-log-food") as HTMLElement;
  const stand = document.createElement("div");
  stand.style.height = "200px";
  panel.prepend(stand);
  const scroller = dialog()?.querySelector<HTMLElement>(".overflow-y-auto") as HTMLElement;
  const foot = panel.querySelector<HTMLElement>(".cm-log-food-foot") as HTMLElement;
  expect(foot.contains(panel.querySelector(".cm-log-food-preview"))).toBe(true);
  expect(foot.contains(panel.querySelector("button[aria-label='Log this food']"))).toBe(true);

  const most = scroller.scrollHeight - scroller.clientHeight;
  expect(most).toBeGreaterThan(0);
  for (const at of [0, Math.round(most / 2), most]) {
    scroller.scrollTop = at;
    await nextFrame();
    expect(scroller.scrollTop).toBe(at);
    expect(foot.getBoundingClientRect().bottom).toBeCloseTo(
      scroller.getBoundingClientRect().bottom,
      0,
    );
  }
});

it("#803 A18 with reduced motion the food sheet fades and does not slide", async () => {
  await commands.emulateMedia({ reducedMotion: "reduce" });
  openFood();
  await wait(0);
  const sheet = dialog() as HTMLElement;
  expect(sheet).not.toBeNull();
  expect(getComputedStyle(sheet).transitionProperty).toContain("opacity");
  expect(getComputedStyle(sheet).transitionProperty).not.toContain("transform");

  await expect.poll(() => Number(getComputedStyle(sheet).opacity), { timeout: 3000 }).toBe(1);
  // It never slid up: it rests on the foot of the screen the whole time.
  expect(sheet.getBoundingClientRect().bottom).toBeCloseTo(window.innerHeight, 0);
});

it("#803 A14 at 390x844 with the keyboard up the food sheet's foot sits above it", async () => {
  // The page sets --keyboard on its frame, as use-keyboard-inset does, and the sheet lifts by it.
  host.style.setProperty("--keyboard", "300px");
  openFood();
  await wait(500);
  const query = view.dom.querySelector<HTMLInputElement>(".cm-log-food-query") as HTMLInputElement;
  query.value = "snickers";
  query.dispatchEvent(new Event("input"));
  await wait(500);
  view.dom.querySelector<HTMLButtonElement>(".cm-log-food-results button")?.click();
  await wait(50);

  const sheet = dialog() as HTMLElement;
  expect(sheet).not.toBeNull();
  const above = window.innerHeight - 300;
  expect(sheet.getBoundingClientRect().bottom).toBeCloseTo(above, 0);
  const log = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Log this food']");
  expect(log).not.toBeNull();
  const box = (log as HTMLButtonElement).getBoundingClientRect();
  expect(box.bottom).toBeLessThanOrEqual(above + 0.5);
  expect(box.top).toBeGreaterThanOrEqual(0);
});

it("#803 A14 at 390x844 with the keyboard up the whole food sheet stays on screen", async () => {
  host.style.setProperty("--keyboard", "300px");
  openFood();
  await wait(500);
  const query = view.dom.querySelector<HTMLInputElement>(".cm-log-food-query") as HTMLInputElement;
  query.value = "snickers";
  query.dispatchEvent(new Event("input"));
  await wait(500);
  view.dom.querySelector<HTMLButtonElement>(".cm-log-food-results button")?.click();
  await wait(50);
  // Taller than the sheet's room, so the sheet is as tall as it may be and not as tall as its content.
  const panel = view.dom.querySelector<HTMLElement>(".cm-log-food") as HTMLElement;
  const stand = document.createElement("div");
  stand.style.height = "900px";
  panel.prepend(stand);

  const sheet = dialog() as HTMLElement;
  expect(sheet).not.toBeNull();
  const box = sheet.getBoundingClientRect();
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeCloseTo(window.innerHeight - 300, 0);
});
