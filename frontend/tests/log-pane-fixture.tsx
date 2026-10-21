import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { LogPane } from "@/components/log-pane";
import type { LogActions } from "@/lib/use-log-actions";
import { stubCommands } from "./stub-commands";

/** The day the pane is given as today. */
export const TODAY = "2026-10-21";
export const PAST = "2026-10-20";
export const TODAY_PATH = "daily/2026-10-21.md";

/** The log config note: a floor, a ceiling, a kind of your own and a food goal. */
export const CONFIG_NOTE = `---
title: log
---
- 💧 water: 250 ml, min 2000
- ☕ coffee: 1, max 3
- 🍺 alcohol: 1
- 🥤 juice: 200 ml, max 500
- 🍽 food: kcal max 2000, protein min 100
`;

const TOTALS_TODAY = {
  water: { ml: 500 },
  coffee: { count: 2 },
  alcohol: { count: 0, ml: 0, grams: 0 },
  food: { kcal: 380, protein: 10, carbs: 50, fat: 5 },
  mine: [{ mark: "🥤", name: "juice", unit: "ml", total: 200 }],
};

/** Today's note: two drinks, a kind of your own, and food under two meals. */
export const TODAY_DAY = {
  date: TODAY,
  path: TODAY_PATH,
  entries: [
    { kind: "water", line: 3, text: "- 💧 500 ml", ml: 500 },
    { kind: "coffee", line: 4, text: "- ☕ 2", count: 2 },
    { kind: "mine", line: 5, mark: "🥤", name: "juice", text: "- 🥤 200 ml" },
    {
      kind: "food",
      line: 7,
      meal: "breakfast",
      words: "oats",
      text: "- 🍽 breakfast: oats 🔥 300 kcal 🥩 10 g 🍞 50 g 🧈 5 g",
      kcal: 300,
      protein: 10,
      carbs: 50,
      fat: 5,
    },
    {
      kind: "food",
      line: 8,
      meal: null,
      words: "apple",
      text: "- 🍽 apple 🔥 80 kcal",
      kcal: 80,
    },
  ],
  totals: TOTALS_TODAY,
};

/** A past day with a litre of water and nothing else. */
export const PAST_DAY = {
  date: PAST,
  path: "daily/2026-10-20.md",
  entries: [{ kind: "water", line: 3, text: "- 💧 1 l", ml: 1000 }],
  totals: {
    water: { ml: 1000 },
    coffee: { count: 0 },
    alcohol: { count: 0, ml: 0, grams: 0 },
    food: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    mine: [],
  },
};

/** A fetchLog answer over `days`: the ones whose date falls in the range asked for. */
export function logDays(days: object[]) {
  return (from: string, to: string) =>
    Promise.resolve(
      days.filter((day) => {
        const date = (day as { date: string }).date;
        return date >= from && date <= to;
      }),
    );
}

/** The five functions the pane writes through, each answering true. */
export function makeActions(canUndo = false): LogActions {
  return {
    addLine: vi.fn(async () => true),
    editLine: vi.fn(async () => true),
    deleteLine: vi.fn(async () => true),
    undoDelete: vi.fn(async () => true),
    canUndo,
  };
}

/** The pane with its query client, the commands and the actions it is given, all recorded. */
export function renderPane(options: { actions?: LogActions; client?: QueryClient } = {}) {
  const client =
    options.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const commands = stubCommands();
  const actions = options.actions ?? makeActions();
  const onOpen = vi.fn();
  const onNotice = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <LogPane
        commands={commands}
        onOpen={onOpen}
        focusSignal={0}
        today={TODAY}
        actions={actions}
        onNotice={onNotice}
      />
    </QueryClientProvider>,
  );
  return { ...view, actions, commands, onOpen, onNotice };
}
