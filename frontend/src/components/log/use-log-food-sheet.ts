import { type RefObject, useEffect, useRef } from "react";
import {
  dropFoodSheet,
  hideFoodSheet,
  type SheetOwner,
  showFoodSheet,
} from "@/components/food-sheet";
import { type FoodPanel, foodPanel } from "@/lib/log/food-search";
import type { FoodGoals } from "@/lib/log/log-kinds";
import type { DrinkTotals } from "@/lib/log/log-lines";
import type { LogActions } from "@/lib/log/use-log-actions";

/** The day's food as the sheet's figures read it, drawn again on each render. */
export interface DayFood {
  eaten: DrinkTotals["food"];
  goals: FoodGoals;
}

/** The food search in the shared sheet, for the day the pane shows. */
export function useLogFoodSheet(
  panel: RefObject<HTMLElement | null>,
  day: string,
  addLine: LogActions["addLine"],
  food: DayFood,
) {
  // The sheet's host sits in the pane's root. Made once, so the sheet keeps the same owner.
  const owner = useRef<SheetOwner>({
    get dom() {
      return panel.current as HTMLElement;
    },
    focus: () => panel.current?.focus(),
  });
  // The food search the sheet shows, while one is up.
  const sheetPanel = useRef<FoodPanel | null>(null);
  // The food panel outlives the render that opened it, so it writes through the latest addLine.
  const writer = useRef(addLine);
  // Read by the food panel each time it draws a figure, so it sees the day as it is now.
  const todayFood = useRef<DayFood>(food);

  useEffect(() => {
    writer.current = addLine;
    todayFood.current = food;
  });

  // Taken down with the pane, so no sheet is left over whatever pane comes next.
  useEffect(() => {
    const self = owner.current;
    return () => {
      sheetPanel.current?.stop();
      sheetPanel.current = null;
      dropFoodSheet(self);
    };
  }, []);

  /** Takes the food search down, when `made` (or the one up) is still the one shown. */
  function closeFood(made: FoodPanel | null = sheetPanel.current) {
    if (made === null || sheetPanel.current !== made) return;
    sheetPanel.current = null;
    made.stop();
    hideFoodSheet(owner.current);
  }

  /** The food search, in the shared sheet, for the day shown. */
  function openFood() {
    if (sheetPanel.current !== null) return;
    const shown = day;
    const made = foodPanel(shown, {
      // A refused write keeps the search open, so the line can be tried again.
      log: (line) => {
        void writer.current(shown, line).then((ok) => {
          if (ok) closeFood(made);
        });
      },
      close: () => closeFood(made),
      today: () => todayFood.current,
    });
    sheetPanel.current = made;
    showFoodSheet(owner.current, made, () => {
      sheetPanel.current = null;
      // The sheet closed by its own hand and still reads as open to its host, so it is drawn
      // shut here, or the next show would mount nothing. The focus is already where it belongs.
      hideFoodSheet(owner.current);
    });
  }

  return { openFood, closeFood };
}
