import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { shiftDay } from "@/lib/clock";
import { CONFIG_NOTE, logDays, renderPane, TODAY } from "./log-pane-fixture";

const { fetchLog, fetchNote, searchFood, readBarcode } = vi.hoisted(() => ({
  fetchLog: vi.fn(),
  fetchNote: vi.fn(),
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
}));

vi.mock("@/lib/food-api", () => ({ fetchLog, searchFood, readBarcode }));
vi.mock("@/lib/my-foods", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/my-foods")>()),
  fetchMyFoods: async () => ({ foods: [], broken: [] }),
  addMyFood: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  fetchNote,
  NoteMissing: class NoteMissing extends Error {},
}));

/** The log config with one more line for each last kind, after the fixture's own. */
function withLines(...lines: string[]): string {
  return `${CONFIG_NOTE}${lines.map((line) => `${line}\n`).join("")}`;
}

const WEIGHT_LINE = "- ⚖ weight: kg, last";

interface Mine {
  mark: string;
  name: string;
  unit: string;
  total: number | null;
}

/** A weight entry of a day's totals, with `kg` as its value and null for a day with no weigh-in. */
function weigh(kg: number | null): Mine {
  return { mark: "⚖", name: "weight", unit: "kg", total: kg };
}

/** A day with a `## Log` whose own kinds total as `mine` says. */
function logged(date: string, mine: Mine[] = []) {
  return {
    date,
    path: `daily/${date}.md`,
    entries: [],
    totals: {
      water: { ml: 0 },
      coffee: { count: 0 },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      mine,
    },
  };
}

/** The day `count` days before today, logged with `mine`. */
function back(count: number, mine: Mine[]) {
  return logged(shiftDay(TODAY, -count), mine);
}

/**
 * The weigh-ins by days back from today: 82.4 today, 82.8 the day before, none two days
 * back, then 83.1, 82.0, 82.9 and 83.6 six days back. The first and last give -1.2 kg, and the
 * 7-day average today is 82.8 kg. The week of Oct 19 means 82.6, the week before 82.9.
 */
const WEEK: (number | null)[] = [82.4, 82.8, null, 83.1, 82.0, 82.9, 83.6];

/** Days that carry WEEK's weigh-ins, each with `extra` entries beside its weigh-in. */
function week(values: (number | null)[] = WEEK, extra: Mine[] = []): object[] {
  return values.map((kg, count) => back(count, [weigh(kg), ...extra]));
}

beforeEach(() => {
  fetchNote.mockResolvedValue(CONFIG_NOTE);
  fetchLog.mockImplementation(logDays([]));
});

afterEach(() => {
  cleanup();
});

/** The Today row that names a kind, or undefined where there is none. */
function rowNamed(name: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(".log-pane-reading")).find(
    (row) => row.querySelector(".log-pane-name")?.textContent === name,
  );
}

/** The summary tile with a label, or undefined where there is none. */
function tileNamed(label: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(".log-summary-tile")).find(
    (tile) => tile.querySelector("dt")?.textContent === label,
  );
}

/** The figure of a summary tile, which is its big words. */
function figureOf(tile: HTMLElement | undefined): string | null | undefined {
  return tile?.querySelector(".log-summary-figure")?.textContent;
}

it("#805 A7 the weight row shows the day's weigh-in and its 7-day average", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  fetchLog.mockImplementation(logDays(week()));
  renderPane();

  await waitFor(() => expect(rowNamed("Weight")?.textContent).toContain("82.4 kg"));
  expect(rowNamed("Weight")?.textContent).toContain("7-day average 82.8 kg");
});

it("#805 A7 the weight row with no weigh-in today gives the latest with its date", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  fetchLog.mockImplementation(logDays([back(0, [weigh(null)]), back(1, [weigh(82.4)])]));
  renderPane();

  await waitFor(() => expect(rowNamed("Weight")?.textContent).toContain("82.4 kg, Oct 20"));
});

it("#805 A7 the weight row with no weigh-in in range is a row, not the empty slot", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  renderPane();

  // The config arrives after the first draw, which shows the empty slot until then.
  await waitFor(() => expect(document.querySelector("[data-kind='weight']")).not.toBeNull());
  expect(rowNamed("Weight")?.textContent).toContain("no weigh-ins yet");
  expect(rowNamed("Weight")).not.toHaveClass("log-pane-slot");
  expect(rowNamed("Weight")?.querySelectorAll("[role='meter']")).toHaveLength(0);
});

it("#805 I6 the weight row reads its goal against the value and says over", async () => {
  fetchNote.mockResolvedValue(withLines("- ⚖ weight: kg, last, max 85"));
  fetchLog.mockImplementation(logDays([back(0, [weigh(86.1)])]));
  renderPane();

  await waitFor(() => expect(rowNamed("Weight")?.textContent).toContain("at most 85, over"));
  expect(rowNamed("Weight")).toHaveClass("log-pane-over");
});

it("#805 I6 the weight row says met for a floor the value passes", async () => {
  fetchNote.mockResolvedValue(withLines("- ⚖ weight: kg, last, min 60"));
  fetchLog.mockImplementation(logDays([back(0, [weigh(61.2)])]));
  renderPane();

  await waitFor(() => expect(rowNamed("Weight")?.textContent).toContain("at least 60, met"));
  expect(rowNamed("Weight")).toHaveClass("log-pane-met");
  expect(rowNamed("Weight")).not.toHaveClass("log-pane-over");
});

it("#805 A8 the weight line draws a dot per weigh-in and the 7-day average", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  fetchLog.mockImplementation(logDays(week()));
  renderPane();

  await waitFor(() => expect(document.querySelectorAll(".log-weight-dot")).toHaveLength(6));
  expect(document.querySelector("polyline.log-weight-avg")).not.toBeNull();
});

it("#805 A8 the weight line's words give the count and the change", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  fetchLog.mockImplementation(logDays(week()));
  renderPane();

  const line = await screen.findByRole("img", {
    name: "weight over 30 days, 6 weigh-ins, change -1.2 kg",
  });
  expect(line.closest("figure")?.textContent).toContain("weight: 6 weigh-ins, latest 82.4 kg");
});

it("#805 A8 the weight chart has a dashed goal and no bar, outside the small multiples", async () => {
  fetchNote.mockResolvedValue(withLines("- ⚖ weight: kg, last, max 85"));
  fetchLog.mockImplementation(logDays(week()));
  renderPane();

  const line = await screen.findByRole("img", { name: /^weight over 30 days/ });
  expect(line.querySelector('line[data-goal="85"].log-chart-goal')).not.toBeNull();
  expect(line.querySelectorAll("rect")).toHaveLength(0);
  expect(line.closest(".log-multiples")).toBeNull();
});

it("#805 A8 the weight line scales to its own range and not from zero", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  fetchLog.mockImplementation(logDays(week()));
  renderPane();

  const line = await screen.findByRole("img", { name: /^weight over 30 days/ });
  const heights = Array.from(line.querySelectorAll("circle"), (dot) =>
    Number(dot.getAttribute("cy")),
  );
  // The lowest weigh-in sits near the foot and the highest near the top, not both near zero.
  expect(Math.max(...heights)).toBeGreaterThan(70);
  expect(Math.min(...heights)).toBeLessThan(10);
});

it("#805 I5 one weigh-in draws one dot and says so in words", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  fetchLog.mockImplementation(logDays([back(0, [weigh(82.4)])]));
  renderPane();

  const line = await screen.findByRole("img", { name: "weight over 30 days, one weigh-in" });
  const dots = line.querySelectorAll("circle.log-weight-dot");
  expect(dots).toHaveLength(1);
  expect(Number.isFinite(Number(dots[0]?.getAttribute("cy")))).toBe(true);
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});

it("#805 I5 no weigh-in in range says so in words and draws no NaN", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  renderPane();

  const line = await screen.findByRole("img", { name: "weight over 30 days, no weigh-ins" });
  expect(line.querySelectorAll("circle")).toHaveLength(0);
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});

it("#805 A9 the weight tile shows the change with its sign and the words from and to", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  fetchLog.mockImplementation(logDays(week()));
  renderPane();

  await waitFor(() => expect(figureOf(tileNamed("Weight"))).toBe("-1.2 kg"));
  expect(tileNamed("Weight")?.querySelector(".log-summary-words")?.textContent).toBe(
    "from 83.6 to 82.4 kg",
  );
});

it("#805 A9 one weigh-in shows its value with the words one weigh-in", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  fetchLog.mockImplementation(logDays([back(0, [weigh(82.4)])]));
  renderPane();

  await waitFor(() => expect(figureOf(tileNamed("Weight"))).toBe("82.4 kg"));
  expect(tileNamed("Weight")?.querySelector(".log-summary-words")?.textContent).toBe(
    "one weigh-in",
  );
});

it("#805 A9 no weigh-in shows a dash and the words no weigh-ins", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  renderPane();

  await waitFor(() => expect(document.querySelector("[data-kind='weight']")).not.toBeNull());
  expect(figureOf(tileNamed("Weight"))).toBe("—");
  expect(tileNamed("Weight")?.querySelector(".log-summary-words")?.textContent).toBe(
    "no weigh-ins",
  );
});

it("#805 A9 a change of nothing reads 0 kg", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  fetchLog.mockImplementation(logDays([back(0, [weigh(82.4)]), back(6, [weigh(82.4)])]));
  renderPane();

  await waitFor(() => expect(figureOf(tileNamed("Weight"))).toBe("0 kg"));
});

it("#805 A10 the week table's weight column is the week's mean weigh-in", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  fetchLog.mockImplementation(logDays(week()));
  renderPane();

  const table = await screen.findByRole("table", { name: "By week" });
  await waitFor(() => {
    const rows = within(table).getAllByRole("row");
    const cell = (label: string) =>
      Array.from(rows)
        .find((row) => row.querySelector("th")?.textContent === label)
        ?.querySelectorAll("th, td")[4]?.textContent;
    expect(cell("Oct 19")).toBe("82.6");
    expect(cell("Oct 12")).toBe("82.9");
  });
  expect(within(table).getByRole("columnheader", { name: "Weight" })).toBeInTheDocument();
});

it("#805 I7 two last kinds each get their own row, line, tile and column", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE, "- 📏 waist: cm, last, min 70"));
  const waist: Mine = { mark: "📏", name: "waist", unit: "cm", total: 90 };
  fetchLog.mockImplementation(logDays(week(WEEK, [waist])));
  renderPane();

  await waitFor(() => expect(rowNamed("Waist")).toBeDefined());
  expect(rowNamed("Waist")?.textContent).toContain("90 cm");
  expect(rowNamed("Waist")?.textContent).toContain("at least 70, met");
  expect(rowNamed("Weight")?.textContent).toContain("82.4 kg");

  expect(tileNamed("Waist")).toBeDefined();
  expect(tileNamed("Weight")).toBeDefined();
  expect(await screen.findByRole("img", { name: /^waist over 30 days/ })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /^weight over 30 days/ })).toBeInTheDocument();
  // Six weigh-ins of weight and seven of waist, which is logged on every day.
  expect(document.querySelectorAll(".log-weight-dot")).toHaveLength(13);

  const table = screen.getByRole("table", { name: "By week" });
  expect(within(table).getByRole("columnheader", { name: "Weight" })).toBeInTheDocument();
  expect(within(table).getByRole("columnheader", { name: "Waist" })).toBeInTheDocument();
});

it("#805 A11 a number in the amount field writes the weight line", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  const { actions } = renderPane();

  fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "82.4" } });
  fireEvent.click(await screen.findByRole("button", { name: "Log weight" }));
  expect(actions.addLine).toHaveBeenLastCalledWith(TODAY, "- ⚖ 82.4 kg");
});

it("#805 A11 an empty amount asks for the weight, focuses the field and hints it", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  const { actions, onNotice } = renderPane();

  fireEvent.click(await screen.findByRole("button", { name: "Log weight" }));
  expect(onNotice).toHaveBeenLastCalledWith("Type the weight in kg");
  expect(actions.addLine).not.toHaveBeenCalled();
  const amount = screen.getByLabelText("Amount");
  expect(amount).toHaveFocus();
  expect(amount).toHaveAttribute("placeholder", "weight in kg");
});

it("#805 A11 the hint goes back to amount once a weight is written", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  const { actions } = renderPane();

  fireEvent.click(await screen.findByRole("button", { name: "Log weight" }));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "82.4" } });
  fireEvent.click(screen.getByRole("button", { name: "Log weight" }));
  expect(actions.addLine).toHaveBeenLastCalledWith(TODAY, "- ⚖ 82.4 kg");
  await waitFor(() =>
    expect(screen.getByLabelText("Amount")).toHaveAttribute("placeholder", "amount"),
  );
});

it("#805 A11 Enter in the amount field after an ask writes the weight line", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  const { actions } = renderPane();

  fireEvent.click(await screen.findByRole("button", { name: "Log weight" }));
  const amount = screen.getByLabelText("Amount");
  fireEvent.change(amount, { target: { value: "82.4" } });
  fireEvent.keyDown(amount, { key: "Enter" });
  expect(actions.addLine).toHaveBeenLastCalledWith(TODAY, "- ⚖ 82.4 kg");
});

it("#805 A11 with no weigh-in on the day the pane's Weight button shows the latest before it with its date and no meter", async () => {
  fetchNote.mockResolvedValue(withLines("- ⚖ weight: kg, last, max 85"));
  fetchLog.mockImplementation(logDays([back(0, [weigh(null)]), back(1, [weigh(82.4)])]));
  renderPane();

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Log weight" })).toHaveTextContent("82.4 kg, Oct 20"),
  );
  expect(
    screen.getByRole("button", { name: "Log weight" }).querySelector("[role='meter']"),
  ).toBeNull();
});

it("#805 A11 a day change clears the weight in kg hint", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  renderPane();

  fireEvent.click(await screen.findByRole("button", { name: "Log weight" }));
  expect(screen.getByLabelText("Amount")).toHaveAttribute("placeholder", "weight in kg");
  fireEvent.click(screen.getByRole("button", { name: "Day before" }));
  expect(screen.getByLabelText("Amount")).toHaveAttribute("placeholder", "amount");
});

it("#805 A2 a weigh-in of 82.45 kg reads 82.45 kg in the Today row and the tile", async () => {
  fetchNote.mockResolvedValue(withLines(WEIGHT_LINE));
  fetchLog.mockImplementation(logDays([back(0, [weigh(82.45)])]));
  renderPane();

  await waitFor(() => expect(rowNamed("Weight")?.textContent).toContain("82.45 kg"));
  expect(figureOf(tileNamed("Weight"))).toBe("82.45 kg");
});

it("#805 guard with no weight kind the four #804 slots render as before", async () => {
  renderPane();

  await waitFor(() => expect(document.querySelector("li[data-slot='weight']")).not.toBeNull());
  expect(document.querySelector("li[data-slot='weight']")?.textContent).toBe(
    "Weight—no weigh-ins yet",
  );
  expect(document.querySelector(".log-summary [data-slot='weight']")?.textContent).toBe(
    "Weight—no weigh-ins yet",
  );
  expect(document.querySelector("figure.log-chart-slot[data-slot='weight']")?.textContent).toBe(
    "WeightNo weigh-ins yet",
  );
  expect(document.querySelectorAll(".log-weeks td[data-slot='weight']").length).toBeGreaterThan(0);
  expect(document.querySelectorAll("[data-kind]")).toHaveLength(0);
});
