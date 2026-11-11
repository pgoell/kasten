import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingPane } from "@/components/log/training/training-pane";
import { fetchNote } from "@/lib/core/api";
import { fetchLog } from "@/lib/log/food-api";
import { fetchTraining, type TrainingDay } from "@/lib/log/training/exercises";
import { parseTrainingLine } from "@/lib/log/training/training-lines";
import { stubCommands } from "../stub-commands";

/** The training pane (#1718): the tiles a week of lines draws, a lift in depth, the keys. */

vi.mock("@/lib/log/training/exercises", async (actual) => ({
  ...(await actual<object>()),
  fetchTraining: vi.fn(),
}));
vi.mock("@/lib/log/food-api", async (actual) => ({
  ...(await actual<object>()),
  fetchLog: vi.fn(),
}));
vi.mock("@/lib/core/api", async (actual) => ({
  ...(await actual<object>()),
  fetchNote: vi.fn(),
}));

const TODAY = "2026-11-11";

function day(date: string, ...lines: string[]): TrainingDay {
  return {
    date,
    entries: lines.flatMap((line) => parseTrainingLine(line) ?? []),
  };
}

const WEEK = [
  day("2026-11-02", "- 🏋 [[Kniebeuge]] 80 kg 8 8 8", "- 🚶 [[Gehen]] 45 min"),
  day("2026-11-04", "- 🏋 [[Bankdrücken]] 60 kg 8 8", "- 🏃 [[Joggen]] 30 min 5 km"),
  day("2026-11-09", "- 🏋 [[Kniebeuge]] 85 kg 8 6", "- 🚲 [[Radfahren]] 60 min 20 km"),
];

function weighIn(date: string, kg: number) {
  return {
    date,
    path: `daily/${date}.md`,
    entries: [],
    totals: {
      water: { ml: 0 },
      coffee: { count: 0 },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      mine: [{ mark: "⚖", name: "weight", unit: "kg", total: kg }],
    },
  };
}

function mount() {
  const commands = stubCommands();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TrainingPane commands={commands as never} focusSignal={1} today={TODAY} />
    </QueryClientProvider>,
  );
  return commands;
}

describe("the training pane", () => {
  beforeEach(() => {
    vi.mocked(fetchTraining).mockReset().mockResolvedValue(WEEK);
    vi.mocked(fetchLog)
      .mockReset()
      .mockResolvedValue([weighIn("2026-11-08", 80), weighIn("2026-11-10", 79.4)] as never);
    vi.mocked(fetchNote).mockReset().mockResolvedValue("- ⚖ weight: kg, last\n");
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("draws a tile per lift, cardio against its target, weight, sessions, pace and records", async () => {
    mount();

    expect(await screen.findByRole("button", { name: "Kniebeuge, open in depth" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bankdrücken, open in depth" })).toBeTruthy();
    expect(screen.getByText("this week, target 150 min")).toBeTruthy();
    expect(screen.getByText("minutes per week, target met in 0 of 12 weeks")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("6:00 /km")).toBeTruthy();
    expect(screen.getByText("Kniebeuge 85 kg")).toBeTruthy();
    expect(await screen.findByText("79.7 kg")).toBeTruthy();
    expect(fetchTraining).toHaveBeenCalledWith("2025-11-12", TODAY);
  });

  it("opens a lift in depth, and Escape goes back to the tiles, then closes", async () => {
    const commands = mount();
    const tile = await screen.findByRole("button", { name: "Kniebeuge, open in depth" });
    tile.focus();
    fireEvent.click(tile);

    const detail = screen.getByRole("region", { name: "Kniebeuge" });
    expect(within(detail).getByText("85 kg")).toBeTruthy();
    expect(within(detail).getByText("8 × 85 kg")).toBeTruthy();
    expect(within(detail).getAllByRole("listitem")).toHaveLength(2);

    // At what holds the focus, as a key press lands: the tile it came from is gone.
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Training" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Kniebeuge" })).toBeNull();
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(commands.closeNote).toHaveBeenCalled();
  });

  it("switches to a year with w", async () => {
    mount();
    await screen.findByRole("button", { name: "Kniebeuge, open in depth" });
    fireEvent.keyDown(screen.getByRole("region", { name: "Training" }), { key: "w" });

    expect(screen.getByRole("tab", { name: "Year" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("minutes per week, target met in 0 of 52 weeks")).toBeTruthy();
  });
});
