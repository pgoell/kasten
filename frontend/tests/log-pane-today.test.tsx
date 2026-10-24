import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import logCases from "@/lib/log-cases.json";
import {
  CONFIG_NOTE,
  logDays,
  makeActions,
  PAST,
  PAST_DAY,
  renderPane,
  TODAY,
  TODAY_DAY,
} from "./log-pane-fixture";
import { NARROW, stubMatchMedia } from "./match-media";

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

const LATER = "2026-10-22";
const OATS = "- 🍽 lunch: oats 🔥 300 kcal 🥩 10 g 🍞 50 g 🧈 5 g";

beforeEach(() => {
  fetchNote.mockResolvedValue(CONFIG_NOTE);
  fetchLog.mockImplementation(logDays([TODAY_DAY, PAST_DAY]));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The pane's root region, which takes the keys. */
const paneOf = () => screen.getByRole("region", { name: "Log" });

/** Presses a key on the pane, as a press reaches it from the focused pane. */
function press(key: string) {
  fireEvent.keyDown(paneOf(), { key });
}

/** Waits until the day's totals are in, which the water meter shows at its 500 ml. */
async function dayLoaded() {
  await waitFor(() =>
    expect(screen.getAllByRole("meter", { name: "water" })[0]).toHaveAttribute(
      "aria-valuenow",
      "500",
    ),
  );
}

/** The Today row that names a kind or a food field, or undefined where there is none. */
function rowNamed(name: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(".log-pane-reading")).find(
    (row) => row.querySelector(".log-pane-name")?.textContent === name,
  );
}

/** The meter of a Today row, or null where the row has no goal. */
function meterIn(name: string): Element | null | undefined {
  return rowNamed(name)?.querySelector("[role='meter']");
}

/** The row the entries cursor is on, which is still there when its column is hidden by a tab. */
function selectedRow(): HTMLElement | undefined {
  return screen
    .getAllByRole("listitem", { hidden: true })
    .find((item) => item.getAttribute("aria-selected") === "true");
}

/** The food search's sheet, or null while it is down. */
const sheetOf = () => screen.queryByRole("dialog", { name: "Food search" });

/** Presses the add row's `+ Food` and returns the sheet it opens. */
async function openFood(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Log food" }));
  return screen.findByRole("dialog", { name: "Food search" });
}

/** Picks the recent oats in the sheet, takes its serving and presses Log this food. */
async function logOats(meal: string) {
  fireEvent.click(await screen.findByRole("button", { name: /oats.*recent/ }));
  fireEvent.change(screen.getByLabelText("Meal"), { target: { value: meal } });
  fireEvent.click(screen.getByRole("button", { name: "Log this food" }));
}

/** A line with its numbers and its words left out, so a line of one case matches another's form. */
function shape(line: string): string {
  return line
    .replace(/^- (\S+) (?:breakfast|lunch|dinner|snack): (.*?) 🔥/, "- $1 MEAL: WORDS 🔥")
    .replace(/\d+(\.\d+)?/g, "N");
}

it("#804 A1 each kind, kcal and macro has a row with its name, total, meter and the goal in words", async () => {
  renderPane();
  await dayLoaded();

  expect(rowNamed("Water")?.textContent).toContain("500 ml");
  expect(rowNamed("Water")?.textContent).toContain("at least 2,000");
  expect(meterIn("Water")?.getAttribute("aria-label")).toBe("water");
  expect(meterIn("Water")?.getAttribute("aria-valuenow")).toBe("500");
  expect(meterIn("Water")?.getAttribute("aria-valuemax")).toBe("2000");

  expect(rowNamed("Coffee")?.textContent).toContain("2");
  expect(rowNamed("Coffee")?.textContent).toContain("at most 3, within");
  expect(rowNamed("Juice")?.textContent).toContain("200 ml");
  expect(rowNamed("Juice")?.textContent).toContain("at most 500, within");
  expect(rowNamed("Alcohol")?.textContent).toContain("0");
  expect(meterIn("Alcohol")).toBeNull();

  expect(rowNamed("Kcal")?.textContent).toContain("380 kcal");
  expect(rowNamed("Kcal")?.textContent).toContain("at most 2,000, within");
  expect(meterIn("Kcal")?.getAttribute("aria-valuenow")).toBe("380");
  expect(rowNamed("Protein")?.textContent).toContain("10 g");
  expect(rowNamed("Protein")?.textContent).toContain("at least 100");
  expect(meterIn("Protein")?.getAttribute("aria-valuemax")).toBe("100");
  expect(rowNamed("Carbs")?.textContent).toContain("50 g");
  expect(meterIn("Carbs")).toBeNull();
});

it("#804 A2 the weight row is an empty slot with no number", async () => {
  renderPane();
  await dayLoaded();

  const slot = document.querySelector<HTMLElement>("[data-slot='weight']");
  expect(slot).not.toBeNull();
  expect(slot?.textContent).toContain("Weight");
  expect(slot?.textContent).toContain("—");
  expect(slot?.textContent).toContain("no weigh-ins yet");
  expect(slot?.querySelector("[role='meter']")).toBeNull();
  expect(slot?.textContent).not.toMatch(/\d/);
});

it("#804 A3 the add buttons are the card's quick buttons and + Food, and a tap writes the kind's line on the day shown", async () => {
  const { actions } = renderPane();
  await dayLoaded();

  const water = screen.getByRole("button", { name: "Log water" });
  expect(water).toHaveClass("cm-log-button");
  expect(water.querySelector("[role='meter']")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Log food" })).toHaveTextContent("+ Food");

  fireEvent.click(water);
  expect(actions.addLine).toHaveBeenLastCalledWith(TODAY, "- 💧 250 ml");

  press("h");
  expect(screen.getByRole("heading", { level: 2, name: PAST })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Log coffee" }));
  expect(actions.addLine).toHaveBeenLastCalledWith(PAST, "- ☕ 1");
});

it("#804 A4 on a desktop + Food opens the food search as the right panel with a scrim in the pane", async () => {
  renderPane();
  await screen.findByRole("heading", { level: 2, name: "Today" });

  const dialog = await openFood();
  expect(dialog.className).toContain("w-[540px]");
  const scrim = dialog.previousElementSibling as HTMLElement;
  expect(scrim.className).toContain("absolute inset-0");
  expect(scrim.className).toContain("bg-black/30");
  expect(paneOf().contains(dialog)).toBe(true);
});

it("#804 A4 on a phone f opens the food search as the bottom sheet with a grabber and no inline panel", async () => {
  stubMatchMedia({ [NARROW]: true });
  renderPane();
  await screen.findByRole("heading", { level: 2, name: "Today" });

  press("f");
  const dialog = await screen.findByRole("dialog", { name: "Food search" });
  expect(dialog.className).toContain("inset-x-0 bottom-0");
  expect(dialog.querySelector("[data-sheet-drag]")).not.toBeNull();
  expect(document.querySelectorAll(".cm-log-food")).toHaveLength(1);
  expect(dialog.querySelector(".cm-log-food")).not.toBeNull();
  expect(dialog.closest(".log-pane-col")).toBeNull();
});

it("#804 A6 the day picker moves the day and Today comes back", async () => {
  renderPane();
  await screen.findByRole("heading", { level: 2, name: "Today" });

  const picker = screen.getByLabelText("Day").closest(".log-pane-head");
  expect(picker?.nextElementSibling?.classList.contains("log-pane")).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Day before" }));
  expect(screen.getByRole("heading", { level: 2, name: PAST })).toBeInTheDocument();
  expect(screen.getByLabelText("Day")).toHaveValue(PAST);
  fireEvent.click(screen.getByRole("button", { name: "Day after" }));
  expect(screen.getByRole("heading", { level: 2, name: "Today" })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Day"), { target: { value: PAST } });
  expect(screen.getByRole("heading", { level: 2, name: PAST })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(screen.getByRole("heading", { level: 2, name: "Today" })).toBeInTheDocument();

  press("h");
  expect(screen.getByRole("heading", { level: 2, name: PAST })).toBeInTheDocument();
  press("t");
  expect(screen.getByRole("heading", { level: 2, name: "Today" })).toBeInTheDocument();
});

it("#804 A13 on a phone Today and Trends are two tabs and a tap shows the other column", async () => {
  stubMatchMedia({ [NARROW]: true });
  renderPane();
  const tabs = screen.getByRole("tablist");
  expect(within(tabs).getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");
  expect(within(tabs).getByRole("tab", { name: "Trends" })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  expect(screen.getByRole("region", { name: "Today" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Trends" })).toBeNull();

  fireEvent.click(within(tabs).getByRole("tab", { name: "Trends" }));
  expect(screen.getByRole("region", { name: "Trends" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Today" })).toBeNull();
});

it("#804 A13 on a desktop Today and Trends both show with no tabs", async () => {
  renderPane();
  await screen.findByRole("heading", { level: 2, name: "Today" });

  expect(screen.queryByRole("tablist")).toBeNull();
  const today = screen.getByRole("region", { name: "Today" });
  const trends = screen.getByRole("region", { name: "Trends" });
  expect(today).toBeVisible();
  expect(trends).toBeVisible();
  expect(today.classList.contains("log-pane-col")).toBe(true);
  expect(trends.parentElement).toBe(today.parentElement);
});

it("#804 A14 a quick tap, an amount and a food pick write their lines byte for byte", async () => {
  const { actions } = renderPane();
  await dayLoaded();

  fireEvent.click(screen.getByRole("button", { name: "Log water" }));
  expect(actions.addLine).toHaveBeenLastCalledWith(TODAY, "- 💧 250 ml");

  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "330" } });
  fireEvent.click(screen.getByRole("button", { name: "Log water" }));
  expect(actions.addLine).toHaveBeenLastCalledWith(TODAY, "- 💧 330 ml");

  await openFood();
  await logOats("lunch");
  expect(actions.addLine).toHaveBeenLastCalledWith(TODAY, OATS);

  // Each line has the same form as a case in log-cases.json, so the pane writes what the log reads.
  for (const line of ["- 💧 250 ml", "- 💧 330 ml", OATS]) {
    expect(logCases.some((written) => shape(written.line) === shape(line))).toBe(true);
  }
});

it("#804 I1 Esc in the sheet closes it, gives the pane the focus and j moves the cursor at once", async () => {
  renderPane();
  await dayLoaded();

  press("f");
  fireEvent.keyDown(await screen.findByLabelText("Food"), { key: "Escape" });
  expect(paneOf()).toHaveFocus();

  press("j");
  expect(selectedRow()).toHaveTextContent("☕ 2");
});

it("#804 I1 a quick button pressed by keyboard keeps the focus and the pane keys still work", async () => {
  const { actions } = renderPane();
  await dayLoaded();

  // The tap clears the amount, which redraws the quick buttons after the write.
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "330" } });
  const water = screen.getByRole("button", { name: "Log water" });
  water.focus();
  // A keyboard press on a focused button reaches the page as a click.
  fireEvent.click(water);
  await waitFor(() => expect(actions.addLine).toHaveBeenCalledWith(TODAY, "- 💧 330 ml"));

  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Log water" }));
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "j" });
  expect(selectedRow()).toHaveTextContent("☕ 2");
});

it("#804 I1 a refused food log keeps the sheet open and a logged one closes it, written to the day shown", async () => {
  const refused = makeActions();
  refused.addLine = vi.fn(async () => false);
  renderPane({ actions: refused });
  await dayLoaded();
  press("l");
  expect(screen.getByRole("heading", { level: 2, name: LATER })).toBeInTheDocument();

  press("f");
  await logOats("lunch");
  await act(async () => {});
  expect(refused.addLine).toHaveBeenCalledWith(LATER, OATS);
  expect(sheetOf()).not.toBeNull();
  cleanup();

  const logged = renderPane({ actions: makeActions() });
  await dayLoaded();
  press("l");
  press("f");
  await logOats("lunch");
  await waitFor(() => expect(sheetOf()).toBeNull());
  expect(logged.actions.addLine).toHaveBeenLastCalledWith(LATER, OATS);
});

it("#804 I2 the pane unmounted with the sheet open leaves no sheet behind", async () => {
  const { unmount } = renderPane();
  await dayLoaded();

  press("f");
  await screen.findByLabelText("Food");
  expect(sheetOf()).not.toBeNull();
  unmount();
  await act(async () => {});

  expect(document.querySelector("[role='dialog']")).toBeNull();
  expect(document.querySelector(".cm-log-food-host")).toBeNull();
});

it("#804 I5 a passed max says over in words and a met floor says met, not colour alone", async () => {
  fetchLog.mockImplementation(
    logDays([
      {
        ...TODAY_DAY,
        totals: {
          ...TODAY_DAY.totals,
          coffee: { count: 4 },
          food: { ...TODAY_DAY.totals.food, protein: 120 },
        },
      },
    ]),
  );
  renderPane();

  await waitFor(() => expect(rowNamed("Coffee")?.textContent).toContain("at most 3, over"));
  expect(rowNamed("Coffee")?.classList.contains("log-pane-over")).toBe(true);
  expect(rowNamed("Protein")?.textContent).toContain("at least 100, met");
  expect(rowNamed("Protein")?.classList.contains("log-pane-met")).toBe(true);
});

it("#804 I6 switching tabs on a phone keeps the day and the cursor, and j still moves it", async () => {
  stubMatchMedia({ [NARROW]: true });
  renderPane();
  await dayLoaded();

  press("j");
  expect(selectedRow()).toHaveTextContent("☕ 2");

  const tabs = screen.getByRole("tablist");
  fireEvent.click(within(tabs).getByRole("tab", { name: "Trends" }));
  expect(screen.getByLabelText("Day")).toHaveValue(TODAY);
  press("j");
  expect(selectedRow()).toHaveTextContent("🥤 200 ml");

  fireEvent.click(within(tabs).getByRole("tab", { name: "Today" }));
  expect(screen.getByLabelText("Day")).toHaveValue(TODAY);
  expect(selectedRow()).toHaveTextContent("🥤 200 ml");
});

it("#804 I8 a failed day read shows its message and the add buttons still write", async () => {
  fetchLog.mockImplementation((from: string, to: string) =>
    from === to ? Promise.reject(new Error("day read failed")) : Promise.resolve([]),
  );
  const { actions } = renderPane();

  const message = await screen.findByText("day read failed");
  expect(message.closest(".log-pane-col")?.getAttribute("aria-label")).toBe("Today");

  fireEvent.click(screen.getByRole("button", { name: "Log water" }));
  expect(actions.addLine).toHaveBeenCalledWith(TODAY, "- 💧 250 ml");
});
