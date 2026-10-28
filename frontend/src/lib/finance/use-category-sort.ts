import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Category, fetchCategories, sortByHand, sortPayee } from "@/lib/finance/finance-api";
import { CATEGORY_KEYS } from "@/lib/finance/finance-keys";

/** What sorting needs of a row: its booking, its split if it is one, and the booking's payee. */
export interface SortRow {
  transaction: number;
  split?: number;
  payee: number | null;
}

/**
 * Sorting a row into a category, by a key or a button, as the to-sort list and the
 * transactions list both do. With "always" armed the row's payee is sorted instead, and every
 * booking of theirs a rule may sort goes with it. After a write every finance read goes stale,
 * since a sort moves money between the budget's categories.
 */
export function useCategorySort(onNotice: (text: string | undefined) => void) {
  const [always, setAlways] = useState(false);
  // A write in the air. Keys and taps that sort wait for it, or a quick second press would sort
  // the same row again, or the row under it into the category meant for this one.
  const [busy, setBusy] = useState(false);
  const queries = useQueryClient();
  const categories = useQuery({ queryKey: ["finance", "categories"], queryFn: fetchCategories });

  async function sort(row: SortRow | undefined, category: Category) {
    if (row === undefined || busy) return;
    const forPayee = always;
    setAlways(false);
    if (forPayee && row.payee === null) {
      onNotice("This booking has no payee to sort");
      return;
    }
    setBusy(true);
    try {
      if (forPayee && row.payee !== null) await sortPayee(row.payee, category.id);
      else await sortByHand(row, category.id);
      onNotice(undefined);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      onNotice(error.message);
    }
    // The lists wait for their fresh read, so the cursor's next row is the one shown; the
    // budget's figures follow in their own time.
    void queries.invalidateQueries({ queryKey: ["finance"] });
    try {
      await Promise.all(
        ["to-sort", "transactions"].map((list) =>
          queries.refetchQueries({ queryKey: ["finance", list], type: "active" }),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  /** The category a key sorts into, if it is one of `CATEGORY_KEYS` and that many are listed. */
  function categoryOf(key: string): Category | undefined {
    const index = key.length === 1 ? CATEGORY_KEYS.indexOf(key) : -1;
    return index === -1 ? undefined : categories.data?.[index];
  }

  return { categories, always, setAlways, busy, sort, categoryOf };
}

export type CategorySort = ReturnType<typeof useCategorySort>;
