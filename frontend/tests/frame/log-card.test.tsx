/**
 * The drink card in a real browser (#620): its buttons and amount field are big
 * enough for a finger on a phone, and the page does not scroll sideways at 414px.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { page } from "vitest/browser";
import { fetchNote, NoteMissing } from "@/lib/api";
import { logCard } from "@/lib/log-card";
import { notePath } from "@/lib/todo-commands";
import { shot } from "./shots";
import "@/styles/app.css";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote: vi.fn(),
}));

// A vault with no config note: the card draws the three default kinds.
beforeEach(() => {
  vi.mocked(fetchNote).mockRejectedValue(new NoteMissing("99 Misc/01 Config/log.md"));
});

vi.mock("@/lib/food-api", () => ({
  searchFood: async () => [
    {
      code: "5000159461122",
      name: "Snickers",
      brand: "Mars Wrigley Confectionery UK Limited",
      serving_g: 100,
      serving_from: "default",
      per_100g: { kcal: 481, protein: 8.6, carbs: 60.5, fat: 22.5 },
      per_serving: { kcal: 481, protein: 8.6, carbs: 60.5, fat: 22.5 },
    },
  ],
  readBarcode: async () => ({
    code: "5000159461122",
    name: "Snickers",
    brand: "Mars Wrigley Confectionery UK Limited",
    serving_g: 50,
    serving_from: "serving_quantity",
    per_100g: { kcal: 481, protein: 8.6, carbs: 60.5, fat: 22.5 },
    per_serving: { kcal: 240, protein: 4.3, carbs: 30.2, fat: 11.2 },
  }),
  fetchLog: async () => [],
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const NOTE = [
  "# 2026-10-20 Tuesday",
  "",
  "[[01 Periodic/00 Daily/2026-10-19]] | [[01 Periodic/00 Daily/2026-10-21]]",
  "",
  "## Log",
  "- 💧 500 ml",
  "- ☕ 1",
  "- 🍺 1 0.5 l 5%",
  "",
  "## Done",
].join("\n");

/** The note on a page of this size, with the card as the note draws it. */
async function mount(width: number, height: number, doc = NOTE) {
  await page.viewport(width, height);
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  const view = new EditorView({
    state: EditorState.create({
      doc,
      // As the app mounts it: a long wikilink line wraps, rather than widening the card.
      extensions: [notePath.of(DAILY), logCard, EditorView.lineWrapping],
    }),
    parent: host,
  });
  await expect.poll(() => view.dom.querySelector(".cm-log button")).not.toBeNull();
  return { host, view };
}

it("#620 a phone's buttons are finger-sized and the page does not scroll sideways", async () => {
  try {
    const { host, view } = await mount(414, 896);

    for (const button of view.dom.querySelectorAll<HTMLElement>(".cm-log button")) {
      expect(
        button.getBoundingClientRect().height,
        button.textContent ?? "",
      ).toBeGreaterThanOrEqual(44);
    }
    const field = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
    expect(field).not.toBeNull();
    expect(getComputedStyle(field as HTMLInputElement).fontSize).toBe("16px");
    const edge = view.dom.getBoundingClientRect().right;
    const controls = [...view.dom.querySelectorAll<HTMLElement>(".cm-log button"), field];
    const past = controls
      .map((control) => ({ control, right: control?.getBoundingClientRect().right ?? 0 }))
      .filter(({ right }) => right > edge)
      .map(({ control, right }) => `${control?.className} right ${right} past ${edge}`);
    expect(past, "controls past the card's right edge").toEqual([]);
    expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expect(await shot(host, "log-card-414")).toBe(414);
    view.destroy();
    host.remove();
  } finally {
    await page.viewport(414, 896);
  }
});

it("#620 the card lays out on a desktop without scrolling sideways", async () => {
  try {
    const { host, view } = await mount(1200, 900);

    for (const button of view.dom.querySelectorAll<HTMLElement>(".cm-log button")) {
      expect(
        button.getBoundingClientRect().height,
        button.textContent ?? "",
      ).toBeGreaterThanOrEqual(44);
    }
    const field = view.dom.querySelector(".cm-log-amount") as HTMLInputElement;
    expect(getComputedStyle(field).fontSize).toBe("16px");
    const edge = view.dom.getBoundingClientRect().right;
    const controls = [...view.dom.querySelectorAll<HTMLElement>(".cm-log button"), field];
    const past = controls
      .filter((control) => control.getBoundingClientRect().right > edge)
      .map((control) => control.textContent ?? "");
    expect(past, "controls past the card's right edge").toEqual([]);
    expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expect(await shot(host, "log-card-1200")).toBe(1200);
    view.destroy();
    host.remove();
  } finally {
    await page.viewport(414, 896);
  }
});

/** Presses the card's 🍽 button, or fails the test where there is none. */
function openFood(view: EditorView): void {
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log food']");
  expect(button).not.toBeNull();
  button?.click();
}

/** Types into the panel's query the way a keyboard does, so its pause starts. */
function typeFood(view: EditorView, text: string): void {
  const query = view.dom.querySelector<HTMLInputElement>(".cm-log-food-query");
  expect(query).not.toBeNull();
  if (query) {
    query.value = text;
    query.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/** Presses the Snickers row of the results. */
function pickSnickers(view: EditorView): void {
  const rows = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-log-food-results button")];
  const pick = rows.find((button) => (button.textContent ?? "").includes("Snickers"));
  expect(pick, "a Snickers result").toBeDefined();
  pick?.click();
}

/**
 * Every control of the card, Undo included, sits inside the card's right edge,
 * and the page does not scroll sideways.
 */
function expectInsideCard(view: EditorView): void {
  const edge = view.dom.getBoundingClientRect().right;
  const controls = [
    ...view.dom.querySelectorAll<HTMLElement>(".cm-log button, .cm-log input"),
  ].filter((control) => control.getClientRects().length > 0);
  const past = controls
    .filter((control) => control.getBoundingClientRect().right > edge)
    .map((control) => control.className || control.textContent || "");
  expect(past, "controls past the card's right edge").toEqual([]);
  expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
    document.documentElement.clientWidth,
  );
}

/**
 * Every control the panel shows is 44px tall, and the text fields and the meal
 * list are 16px, so a phone's browser does not zoom into them. The card's edge is
 * not passed, and the page does not scroll sideways.
 */
function expectFingerSized(view: EditorView): void {
  const shown = [
    ...view.dom.querySelectorAll<HTMLElement>(
      ".cm-log-food button, .cm-log-food input, .cm-log-food select",
    ),
  ].filter((control) => control.getClientRects().length > 0);
  expect(shown.length).toBeGreaterThan(0);
  for (const control of shown) {
    expect(control.getBoundingClientRect().height, control.className).toBeGreaterThanOrEqual(44);
    if (control.tagName !== "BUTTON") {
      expect(getComputedStyle(control).fontSize, control.className).toBe("16px");
    }
  }
  const edge = view.dom.getBoundingClientRect().right;
  const past = shown
    .filter((control) => control.getBoundingClientRect().right > edge)
    .map((control) => control.className);
  expect(past, "controls past the card's right edge").toEqual([]);
  expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
    document.documentElement.clientWidth,
  );
}

it("#621 the food search and the serving choice are finger-sized and do not scroll sideways at 414", async () => {
  try {
    const { host, view } = await mount(414, 896);
    openFood(view);
    typeFood(view, "snickers");
    await expect
      .poll(() => view.dom.querySelector(".cm-log-food-results")?.textContent ?? "")
      .toContain("Snickers");
    expectFingerSized(view);
    expect(await shot(host, "food-search-414")).toBe(414);

    pickSnickers(view);
    await expect
      .poll(() => view.dom.querySelector(".cm-log-food-preview")?.textContent ?? "")
      .toContain("kcal");
    expectFingerSized(view);
    expect(await shot(host, "food-serving-414")).toBe(414);

    const log = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Log this food']");
    expect(log).not.toBeNull();
    log?.click();
    await expect.poll(() => view.dom.querySelector(".cm-log-undo")).not.toBeNull();
    expectInsideCard(view);
    expect(await shot(host, "food-logged-414")).toBe(414);
    view.destroy();
    host.remove();
  } finally {
    await page.viewport(414, 896);
  }
});

it("#799 the add form is finger-sized and does not scroll sideways at 414", async () => {
  try {
    const { host, view } = await mount(414, 896);
    openFood(view);
    const add = view.dom.querySelector<HTMLButtonElement>(".cm-log-food-new");
    expect(add).not.toBeNull();
    add?.click();
    await expect
      .poll(() => view.dom.querySelector<HTMLElement>(".cm-log-food-add")?.hidden)
      .toBe(false);
    expectFingerSized(view);
    expect(await shot(host, "food-add-414")).toBe(414);
    view.destroy();
    host.remove();
  } finally {
    await page.viewport(414, 896);
  }
});

it("#621 the food search and the serving choice lay out on a desktop", async () => {
  try {
    const { host, view } = await mount(1200, 900);
    openFood(view);
    typeFood(view, "snickers");
    await expect
      .poll(() => view.dom.querySelector(".cm-log-food-results")?.textContent ?? "")
      .toContain("Snickers");
    expectFingerSized(view);
    expect(await shot(host, "food-search-1200")).toBe(1200);

    pickSnickers(view);
    await expect
      .poll(() => view.dom.querySelector(".cm-log-food-preview")?.textContent ?? "")
      .toContain("kcal");
    expectFingerSized(view);
    expect(await shot(host, "food-serving-1200")).toBe(1200);
    view.destroy();
    host.remove();
  } finally {
    await page.viewport(414, 896);
  }
});

const GOALS_CONFIG = [
  "---",
  "type: Config",
  "---",
  "- 💧 water: 250 ml, min 500",
  "- 🍵 tea: 1 cup, min 3",
  "- ☕ coffee: 1",
  "- 🍺 alcohol: 1, max 1",
  "- 🧃 juice: lots",
  "- 🍽 food: kcal max 2200, protein min 120",
].join("\n");

const GOALS_NOTE = [
  "# 2026-10-20 Tuesday",
  "",
  "## Log",
  "- 💧 500 ml",
  "- 🍵 1 cup",
  "- ☕ 1",
  "- 🍺 1 0.5 l 5%",
  "- 🍺 1",
  "- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g",
  "",
  "## Done",
].join("\n");

/**
 * The card with goals and a broken config line at a page of this size: its buttons
 * are finger-sized and inside the card, the broken line too, and a tea tap by touch
 * writes the tea line. The card is shot before the tap, so the shot shows the goals.
 */
async function checkGoalsCard(width: number, height: number, name: string): Promise<void> {
  try {
    vi.mocked(fetchNote).mockResolvedValue(GOALS_CONFIG);
    const { host, view } = await mount(width, height, GOALS_NOTE);
    await expect
      .poll(() => view.dom.querySelector(".cm-log button[aria-label='Log tea']"))
      .not.toBeNull();

    for (const button of view.dom.querySelectorAll<HTMLElement>(".cm-log button")) {
      expect(
        button.getBoundingClientRect().height,
        button.textContent ?? "",
      ).toBeGreaterThanOrEqual(44);
    }
    expectInsideCard(view);
    const edge = view.dom.getBoundingClientRect().right;
    const named = view.dom.querySelectorAll<HTMLElement>(".cm-log-broken > div");
    expect(named).toHaveLength(1);
    for (const line of named) {
      expect(line.getBoundingClientRect().right, line.textContent ?? "").toBeLessThanOrEqual(edge);
    }
    expect(await shot(host, name)).toBe(width);

    const tea = view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log tea']");
    expect(tea).not.toBeNull();
    // A touch presses through the pointer and mouse events before the click.
    tea?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    tea?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    tea?.click();
    expect(view.state.doc.toString()).toContain("- 🍵 1 cup");
    view.destroy();
    host.remove();
  } finally {
    await page.viewport(414, 896);
  }
}

it("#623 the card with goals at 414 by touch", async () => {
  await checkGoalsCard(414, 896, "log-goals-414");
});

it("#623 the card with goals on a desktop", async () => {
  await checkGoalsCard(1200, 900, "log-goals-1200");
});
