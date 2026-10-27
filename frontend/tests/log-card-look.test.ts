import { history } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Forecast, fetchNote, fetchWeather, NoteMissing } from "@/lib/api";
import { fetchLog, type LogDay } from "@/lib/log/food-api";
import { logCard, reloadLogConfig } from "@/lib/log/log-card";
import { weatherCard } from "@/lib/note/weather-card";
import { notePath } from "@/lib/todo/todo-commands";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote: vi.fn(),
  fetchWeather: vi.fn(),
}));
vi.mock("@/lib/log/food-api", () => ({
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
  fetchLog: vi.fn(),
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const LOG = "99 Misc/01 Config/log.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";
const DEFAULTS = "- 💧 water: 250 ml\n- ☕ coffee: 1\n- 🍺 alcohol: 1";

const mounted: EditorView[] = [];

beforeEach(() => {
  vi.mocked(fetchNote).mockRejectedValue(new NoteMissing(LOG));
  vi.mocked(fetchLog).mockResolvedValue([]);
  reloadLogConfig();
});

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});

/** A view on `doc` with the card and `extra`, the cursor at the start. */
function mount(doc: string, extra: Extension[] = [], path = DAILY): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [notePath.of(path), history(), logCard, ...extra],
    }),
    parent,
  });
  mounted.push(view);
  return view;
}

/** Reads `config` as log.md, then mounts `doc` and lets the config's answer in. */
async function mountWith(
  config: string,
  doc: string,
  extra: Extension[] = [],
): Promise<EditorView> {
  vi.mocked(fetchNote).mockResolvedValue(`${DEFAULTS}\n${config}`);
  reloadLogConfig();
  const view = mount(doc, extra);
  // The store answers in the background, one timer turn after the mock resolves.
  await new Promise((done) => setTimeout(done, 0));
  return view;
}

/** A daily note whose `## Log` holds `lines`, and a `## Done` after it. */
const day = (lines: string) => `# 2026-10-20 Tuesday\n\n## Log\n${lines}\n\n## Done\n- [ ] write`;

const text = (view: EditorView) => view.state.doc.toString();

const big = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-log-big");
const bigFigure = (view: EditorView) => big(view)?.querySelector(".cm-log-big-figure")?.textContent;
const bigWords = (view: EditorView) => big(view)?.querySelector<HTMLElement>(".cm-log-big-words");
const ringItems = (view: EditorView) => [
  ...view.dom.querySelectorAll<HTMLElement>(".cm-log-ring-item"),
];
const kindButton = (view: EditorView, name: string) =>
  view.dom.querySelector<HTMLButtonElement>(`.cm-log button[aria-label='Log ${name}']`);

const FOOD = day("- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g 🍞 10 g 🧈 0 g");

describe("the log card's look", () => {
  it("#803 A1 the weather sits in one line above the card", async () => {
    const forecast: Forecast = {
      place: "Gelnhausen",
      sunrise: "07:32",
      sunset: "18:48",
      hours: Array.from({ length: 24 }, (_, hour) => ({
        time: `${String(hour).padStart(2, "0")}:00`,
        temperature: 10 + hour / 2,
        rain_chance: 0,
        rain: 0,
        code: 0,
      })),
    };
    vi.mocked(fetchWeather).mockResolvedValue([forecast]);
    const view = mount(NOTE, [weatherCard]);
    await vi.waitFor(() => expect(view.dom.querySelector(".cm-weather-line")).not.toBeNull());
    const line = view.dom.querySelector(".cm-weather-line")?.textContent ?? "";
    expect(line).toContain("Gelnhausen");
    expect(line).toContain("10° to 21.5°C");
    const weather = view.dom.querySelector(".cm-weather") as HTMLElement;
    const card = view.dom.querySelector(".cm-log") as HTMLElement;
    expect(weather.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("#803 A2 the big number is kcal left with eaten of goal, at most, and one bar", async () => {
    const view = await mountWith("- 🍽 food: kcal max 2000", FOOD);
    expect(bigFigure(view)).toBe("1840");
    expect(bigWords(view)?.textContent).toBe("kcal left");
    expect(big(view)?.querySelector(".cm-log-big-goal")?.textContent).toBe(
      "160 of 2000 kcal, at most",
    );
    expect(big(view)?.querySelectorAll("[role='meter']")).toHaveLength(1);
  });

  it("#803 I3 with no kcal goal the big number is kcal eaten and there is no bar", async () => {
    const view = await mountWith("", FOOD);
    expect(bigFigure(view)).toBe("160");
    expect(bigWords(view)?.textContent).toBe("kcal eaten");
    expect(big(view)?.textContent).not.toContain("left");
    expect(big(view)?.querySelector("[role='meter']")).toBeNull();
  });

  it("#803 I4 past the kcal goal the card says kcal over in words and marks it as a warning", async () => {
    const view = await mountWith("- 🍽 food: kcal max 100", FOOD);
    expect(bigFigure(view)).toBe("60");
    expect(bigWords(view)?.textContent).toBe("kcal over");
    expect(bigWords(view)?.classList.contains("cm-log-warn")).toBe(true);
    expect(
      big(view)
        ?.querySelector<HTMLElement>("[role='meter']")
        ?.style.getPropertyValue("--log-progress"),
    ).toBe("100%");
  });

  it("#803 A3 protein, carbs and fat are rings with a label and their goal written out", async () => {
    const view = await mountWith("- 🍽 food: protein min 120, carbs max 250, fat max 70", FOOD);
    const items = ringItems(view);
    expect(items.map((item) => item.querySelector(".cm-log-ring-name")?.textContent)).toEqual([
      "Protein",
      "Carbs",
      "Fat",
    ]);
    expect(items[0]?.textContent).toContain("27 g of 120 g, at least");
    expect(items[1]?.textContent).toContain("10 g of 250 g, at most");
    expect(items[2]?.textContent).toContain("0 g of 70 g, at most");
    expect(view.dom.querySelectorAll(".cm-log-ring")).toHaveLength(3);
  });

  it("#803 A16 the warning mark is only on a passed max goal, never on a min goal not met", async () => {
    const view = await mountWith(
      "- 🍽 food: kcal max 2000, protein min 120, fat max 70",
      day("- 🍽 lunch: Skyr 🥩 27 g 🧈 80 g"),
    );
    const items = ringItems(view);
    const protein = items[0];
    const fat = items[2];
    expect(protein?.querySelector(".cm-log-warn")).toBeNull();
    expect(fat?.querySelector(".cm-log-warn")).not.toBeNull();
    expect(fat?.textContent).toContain("80 g of 70 g, at most");
    expect(bigWords(view)?.classList.contains("cm-log-warn")).toBe(false);
  });

  it("#803 A4 each kind of log.md has a quick button with its total and goal meter", async () => {
    const view = await mountWith("- 🍵 tea: 1 cup, min 3", day("- 💧 500 ml\n- 🍵 2 cup"));
    const tea = kindButton(view, "tea");
    expect(tea?.textContent).toContain("🍵 2 / 3 cup");
    expect(tea?.querySelector("[role='meter']")).not.toBeNull();
    expect(kindButton(view, "water")?.textContent).toContain("💧 500 ml");
    expect(kindButton(view, "water")?.querySelector("[role='meter']")).toBeNull();
  });

  it("#803 A5 + Food is the main button and opens the food search", async () => {
    const view = mount(NOTE);
    const main = view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log food']");
    expect(main?.textContent).toBe("+ Food");
    expect(main?.classList.contains("cm-log-button-main")).toBe(true);
    main?.click();
    await vi.waitFor(() =>
      expect(view.dom.querySelector("input[aria-label='Food']")).not.toBeNull(),
    );
  });

  it("#803 A6 entries are grouped by the four meals with kcal per meal and P C F per entry", async () => {
    const view = mount(
      day(
        "- 🍽 dinner: Soup 🔥 90 kcal\n- 🍽 breakfast: Skyr 250 g 🔥 160 kcal 🥩 27 g 🍞 10 g 🧈 0 g\n- 🍽 breakfast: Egg 🔥 80 kcal 🥩 6 g",
      ),
    );
    const names = [...view.dom.querySelectorAll(".cm-log-meal-name")].map(
      (node) => node.textContent,
    );
    expect(names).toEqual(["Breakfast", "Dinner"]);
    const heads = [...view.dom.querySelectorAll(".cm-log-meal-head")].map(
      (node) => node.textContent,
    );
    expect(heads[0]).toBe("Breakfast240 kcal");
    const entry = view.dom.querySelector(".cm-log-entry")?.textContent ?? "";
    expect(entry).toContain("Skyr 250 g");
    expect(entry).toContain("160 kcal");
    expect(entry).toContain("P 27");
    expect(entry).toContain("C 10");
    expect(entry).toContain("F 0");
  });

  it("#803 I5 a food line with no meal shows under No meal and counts", async () => {
    const view = await mountWith("", day("- 🍽 Skyr 🔥 100 kcal"));
    const names = [...view.dom.querySelectorAll(".cm-log-meal-name")].map(
      (node) => node.textContent,
    );
    expect(names).toEqual(["No meal"]);
    expect(bigFigure(view)).toBe("100");
  });

  it("#803 I8 the search opens again with an empty query after Log this food", async () => {
    const day = {
      date: "2026-10-19",
      path: "01 Periodic/00 Daily/2026-10-19.md",
      entries: [
        {
          line: 5,
          text: "- 🍽 lunch: Skyr naturel (Skyr) 150 g 🔥 90 kcal 🥩 15 g 🍞 6 g 🧈 0 g",
          kind: "food",
          meal: "lunch",
          words: "Skyr naturel (Skyr) 150 g",
          kcal: 90,
          protein: 15,
          carbs: 6,
          fat: 0,
        },
      ],
      totals: {},
    };
    vi.mocked(fetchLog).mockResolvedValue([day] as unknown as LogDay[]);
    const view = mount(NOTE);
    const press = (label: string) =>
      view.dom.querySelector<HTMLButtonElement>(`.cm-log button[aria-label='${label}']`)?.click();
    const results = () => view.dom.querySelector<HTMLButtonElement>(".cm-log-food-results button");

    press("Log food");
    await vi.waitFor(() => expect(results()).not.toBeNull());
    results()?.click();
    await vi.waitFor(() =>
      expect(view.dom.querySelector("button[aria-label='Log this food']")).not.toBeNull(),
    );
    view.dom.querySelector<HTMLButtonElement>("button[aria-label='Log this food']")?.click();
    // The meal is the hour's, so the line is matched by its words and kcal.
    expect(text(view)).toContain("Skyr naturel (Skyr) 150 g 🔥 90 kcal");

    press("Log food");
    await vi.waitFor(() => expect(results()).not.toBeNull());
    expect(view.dom.querySelector<HTMLInputElement>(".cm-log-food-query")?.value).toBe("");
  });

  it("#803 A8 the raw lines fold shows the lines under ## Log exactly", async () => {
    const view = mount(day("- 💧 500 ml"));
    const fold = view.dom.querySelector<HTMLDetailsElement>(".cm-log-raw");
    expect(fold?.querySelector("summary")?.textContent).toBe("Raw lines");
    expect(fold?.open).toBe(false);
    expect(fold?.querySelector("pre")?.textContent).toBe("- 💧 500 ml\n");
  });
});
