import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { LOG_NOTE } from "@/lib/layout";
import {
  CONFIG_NOTE,
  logDays,
  makeActions,
  PAST,
  PAST_DAY,
  renderPane,
  TODAY,
  TODAY_DAY,
  TODAY_PATH,
} from "./log-pane-fixture";

const { fetchLog, fetchNote, searchFood, readBarcode } = vi.hoisted(() => ({
  fetchLog: vi.fn(),
  fetchNote: vi.fn(),
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
}));

vi.mock("@/lib/food-api", () => ({ fetchLog, searchFood, readBarcode }));
vi.mock("@/lib/my-foods", () => ({
  fetchMyFoods: async () => ({ foods: [], broken: [] }),
  addMyFood: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  fetchNote,
  NoteMissing: class NoteMissing extends Error {},
}));

beforeEach(() => {
  fetchNote.mockResolvedValue(CONFIG_NOTE);
  fetchLog.mockImplementation(logDays([TODAY_DAY, PAST_DAY]));
});

/** Presses a key on the pane, as a press reaches it from the focused list. */
function press(key: string) {
  fireEvent.keyDown(screen.getByRole("region", { name: "Log" }), { key });
}

/** The row the cursor is on. */
function selectedRow(): HTMLElement | undefined {
  return screen
    .getAllByRole("listitem")
    .find((item) => item.getAttribute("aria-selected") === "true");
}

/** The edit form open on a row, or null while no row is an edit. */
function editForm(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".log-pane-edit");
}

it("#624 Today shows each kind against its goal and the food day grouped by meal", async () => {
  renderPane();

  expect(await screen.findByText("💧 500 / 2000 ml")).toBeInTheDocument();
  expect(screen.getByText("☕ 2 / 3")).toBeInTheDocument();
  expect(screen.getByText("🥤 200 / 500 ml")).toBeInTheDocument();
  expect(screen.getByText("🔥 380 / 2000 kcal")).toBeInTheDocument();
  expect(screen.getByText("🥩 10 / 100 g")).toBeInTheDocument();
  expect(screen.getByRole("meter", { name: "water" })).toHaveAttribute("aria-valuenow", "500");
  expect(screen.getByRole("meter", { name: "water" })).toHaveAttribute("aria-valuemax", "2000");
  expect(screen.getByRole("heading", { level: 3, name: "breakfast" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 3, name: "no meal" })).toBeInTheDocument();
});

it("#624 a kind button and the amount field add through addLine on the day shown", async () => {
  const { actions } = renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  fireEvent.click(screen.getByRole("button", { name: "Log water" }));
  expect(actions.addLine).toHaveBeenLastCalledWith(TODAY, "- 💧 250 ml");

  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "500" } });
  fireEvent.click(screen.getByRole("button", { name: "Log water" }));
  expect(actions.addLine).toHaveBeenLastCalledWith(TODAY, "- 💧 500 ml");

  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "300" } });
  fireEvent.click(screen.getByRole("button", { name: "Log juice" }));
  expect(actions.addLine).toHaveBeenLastCalledWith(TODAY, "- 🥤 300 ml");
});

it("#624 h and l and the day buttons move the day, and logging on a past day writes that day", async () => {
  const { actions } = renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  press("h");
  expect(await screen.findByRole("heading", { level: 2, name: PAST })).toBeInTheDocument();
  expect(fetchLog).toHaveBeenCalledWith(PAST, PAST);

  fireEvent.click(screen.getByRole("button", { name: "Log coffee" }));
  expect(actions.addLine).toHaveBeenLastCalledWith(PAST, "- ☕ 1");

  fireEvent.click(screen.getByRole("button", { name: "Day after" }));
  expect(screen.getByLabelText("Day")).toHaveValue(TODAY);

  fireEvent.change(screen.getByLabelText("Day"), { target: { value: PAST } });
  expect(await screen.findByRole("heading", { level: 2, name: PAST })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Today" })).toBeInTheDocument();
});

it("#624 e or a tap edits the row's amount and Save calls editLine with the line and its text", async () => {
  const { actions } = renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  fireEvent.click(screen.getByRole("button", { name: "💧 500 ml" }));
  fireEvent.change(within(editForm() as HTMLElement).getByLabelText("Amount"), {
    target: { value: "750" },
  });
  fireEvent.click(within(editForm() as HTMLElement).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(actions.editLine).toHaveBeenLastCalledWith(
      TODAY,
      { line: 3, text: "- 💧 500 ml" },
      "- 💧 750 ml",
    ),
  );
  await waitFor(() => expect(editForm()).toBeNull());

  press("j");
  press("j");
  press("e");
  const form = editForm() as HTMLElement;
  expect(within(form).getByLabelText("Amount")).toHaveValue("200 ml");
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "250 ml" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(actions.editLine).toHaveBeenLastCalledWith(
      TODAY,
      { line: 5, text: "- 🥤 200 ml" },
      "- 🥤 250 ml",
    ),
  );
});

it("#624 a food row's edit sets meal and servings", async () => {
  const { actions } = renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  press("j");
  press("j");
  press("j");
  press("e");
  const form = editForm() as HTMLElement;
  expect(within(form).getByLabelText("Meal")).toHaveValue("breakfast");
  expect(within(form).getByLabelText("Servings")).toHaveValue("1");
  fireEvent.change(within(form).getByLabelText("Meal"), { target: { value: "dinner" } });
  fireEvent.change(within(form).getByLabelText("Servings"), { target: { value: "2" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(actions.editLine).toHaveBeenCalledWith(
      TODAY,
      {
        line: 7,
        text: "- 🍽 breakfast: oats 🔥 300 kcal 🥩 10 g 🍞 50 g 🧈 5 g",
      },
      "- 🍽 dinner: oats 🔥 600 kcal 🥩 20 g 🍞 100 g 🧈 10 g",
    ),
  );
});

it("#624 d deletes the row under the cursor and Undo puts it back", async () => {
  const { actions } = renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  press("d");
  expect(actions.deleteLine).toHaveBeenCalledWith(TODAY, { line: 3, text: "- 💧 500 ml" });
  cleanup();

  const undone = renderPane({ actions: makeActions(true) });
  await screen.findByText("💧 500 / 2000 ml");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(undone.actions.undoDelete).toHaveBeenCalledTimes(1);
});

it("#624 o opens the note at the entry's line", async () => {
  const { onOpen } = renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  press("j");
  press("o");

  expect(onOpen).toHaveBeenCalledWith(TODAY_PATH, 4);
});

it("#624 j and k move the cursor and keys typed in the amount field are not pane keys", async () => {
  const { actions } = renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  press("j");
  expect(selectedRow()).toHaveTextContent("☕ 2");
  press("k");
  expect(selectedRow()).toHaveTextContent("💧 500 ml");

  const amount = screen.getByLabelText("Amount");
  fireEvent.keyDown(amount, { key: "j" });
  fireEvent.keyDown(amount, { key: "d" });

  expect(selectedRow()).toHaveTextContent("💧 500 ml");
  expect(actions.deleteLine).not.toHaveBeenCalled();
});

it("#624 Escape leaves the edit without writing", async () => {
  const { actions } = renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  fireEvent.click(screen.getByRole("button", { name: "💧 500 ml" }));
  const amount = within(editForm() as HTMLElement).getByLabelText("Amount");
  fireEvent.change(amount, { target: { value: "750" } });
  fireEvent.keyDown(amount, { key: "Escape" });

  expect(editForm()).toBeNull();
  expect(actions.editLine).not.toHaveBeenCalled();
});

it("#624 Trends draws a bar per logged day and the goal as a line over 7, 30 and 90 days", async () => {
  renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  const month = await screen.findByRole("img", { name: "water over 30 days" });
  await waitFor(() => expect(month.querySelectorAll("rect.log-chart-bar")).toHaveLength(2));
  expect(month.querySelector('line[data-goal="2000"]')).not.toBeNull();

  press("7");
  expect(fetchLog).toHaveBeenLastCalledWith("2026-10-15", TODAY);
  const week = await screen.findByRole("img", { name: "water over 7 days" });
  await waitFor(() => expect(week.querySelectorAll("rect.log-chart-bar")).toHaveLength(2));

  press("9");
  expect(await screen.findByRole("img", { name: "water over 90 days" })).toBeInTheDocument();
});

it("#624 a day with no log draws no bar and is left out of the average", async () => {
  renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  press("7");
  const week = await screen.findByRole("img", { name: "water over 7 days" });
  await waitFor(() => expect(week.querySelectorAll("rect.log-chart-bar")).toHaveLength(2));
  // The 7 days include 19 October, which the answer leaves out: the average is of the two logged days.
  expect(screen.getByText(/average 750 ml over 2 logged days/)).toBeInTheDocument();
});

it("#624 a failed log read shows its message and adding still works", async () => {
  fetchLog.mockRejectedValue(new Error("log read failed"));
  const { actions } = renderPane();

  const alerts = await screen.findAllByRole("alert");
  expect(alerts[0]).toHaveTextContent("log read failed");

  fireEvent.click(screen.getByRole("button", { name: "Log water" }));
  expect(actions.addLine).toHaveBeenCalledWith(TODAY, "- 💧 250 ml");
});

it("#624 a kind of your own shows in Today and Trends and its row edits", async () => {
  const { actions } = renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  expect(screen.getByRole("meter", { name: "juice" })).toHaveAttribute("aria-valuenow", "200");
  expect(await screen.findByRole("img", { name: "juice over 30 days" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "🥤 200 ml" }));
  const form = editForm() as HTMLElement;
  expect(within(form).getByLabelText("Amount")).toHaveValue("200 ml");
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "300" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(actions.editLine).toHaveBeenCalledWith(
      TODAY,
      { line: 5, text: "- 🥤 200 ml" },
      "- 🥤 300 ml",
    ),
  );
});

it("#624 the food search opens from the pane and logs into the day shown", async () => {
  const { actions } = renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  press("f");
  const query = await screen.findByLabelText("Food");
  expect(query).toHaveFocus();

  // The entry row reads `oats` too, so the pick is the one the search lists as recent.
  fireEvent.click(await screen.findByRole("button", { name: /oats.*recent/ }));
  fireEvent.change(screen.getByLabelText("Meal"), { target: { value: "lunch" } });
  fireEvent.click(screen.getByRole("button", { name: "Log this food" }));

  expect(actions.addLine).toHaveBeenCalledWith(
    TODAY,
    "- 🍽 lunch: oats 🔥 300 kcal 🥩 10 g 🍞 50 g 🧈 5 g",
  );
  await waitFor(() => expect(screen.queryByLabelText("Food")).toBeNull());
});

it("#624 the pane and an editor share log.md's query as text", async () => {
  // The raw note is what an editor of log.md caches under this key, so the pane must read the same text.
  const TEA_NOTE = `${CONFIG_NOTE}- 🍵 tea: 150 ml\n`;
  fetchNote.mockResolvedValue(TEA_NOTE);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(["note", LOG_NOTE], TEA_NOTE);

  renderPane({ client });

  expect(await screen.findByRole("button", { name: "Log tea" })).toBeInTheDocument();
  expect(client.getQueryData(["note", LOG_NOTE])).toBe(TEA_NOTE);
});

it("#624 Enter on a focused row button edits that row, not the cursor row", async () => {
  renderPane();
  await screen.findByText("💧 500 / 2000 ml");

  press("j");
  const juice = screen.getByRole("button", { name: "🥤 200 ml" });
  juice.focus();
  // The key press alone must not open the cursor's row. The browser's Enter on a button is then its click.
  fireEvent.keyDown(juice, { key: "Enter" });
  expect(editForm()).toBeNull();
  fireEvent.click(juice);

  expect(within(editForm() as HTMLElement).getByLabelText("Amount")).toHaveValue("200 ml");
});

it("#624 a refused food log keeps the food search open", async () => {
  const { actions } = renderPane();
  actions.addLine = vi.fn(async () => false);
  await screen.findByText("💧 500 / 2000 ml");

  press("f");
  fireEvent.click(await screen.findByRole("button", { name: /oats.*recent/ }));
  fireEvent.click(screen.getByRole("button", { name: "Log this food" }));
  await act(async () => {});

  expect(actions.addLine).toHaveBeenCalled();
  expect(screen.getByLabelText("Food")).toBeInTheDocument();
});
