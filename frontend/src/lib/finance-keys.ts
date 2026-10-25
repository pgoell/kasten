/**
 * The finance pane's keys. Apart from `key-bindings.ts`, which is past the size a reader
 * can take in one go, and beside the keys categories take, which the table names.
 */

/**
 * The keys categories take, in the order the categories are listed. The pane's own keys are
 * left out: `j` and `k` move, `a` arms "always for this payee", `q` closes, and the tabs,
 * the month and "pull now" take upper case and brackets. A category past the last key is
 * reached by its button only.
 */
export const CATEGORY_KEYS = "1234567890bcdefghilmnoprstuvwxyz";

export type FinanceTab = "overview" | "to-sort" | "transactions" | "budget";

/** The pane's four tabs, in order, each with the key that shows it. Upper case, as the lower keys sort. */
export const FINANCE_TABS: readonly { tab: FinanceTab; label: string; key: string }[] = [
  { tab: "overview", label: "Overview", key: "O" },
  { tab: "to-sort", label: "To sort", key: "S" },
  { tab: "transactions", label: "Transactions", key: "T" },
  { tab: "budget", label: "Budget", key: "B" },
];

/** What the keys do inside the finance pane. Display only, the way `TODO_PANE` in `key-bindings.ts` is. */
export const FINANCE_PANE: readonly { key: string; label: string }[] = [
  { key: "O", label: "Show the overview" },
  { key: "S", label: "Show the bookings to sort" },
  { key: "T", label: "Show the transactions" },
  { key: "B", label: "Show the budget" },
  { key: "[", label: "Show the month before" },
  { key: "]", label: "Show the month after" },
  { key: "P", label: "Pull now: ask the bank job for a pull" },
  { key: "j", label: "Move to the next booking or category" },
  { key: "k", label: "Move to the previous booking or category" },
  {
    key: "1",
    label:
      "To sort and transactions: sort the booking into the first category; each button shows its key",
  },
  {
    key: "a",
    label: "To sort and transactions: the next category key sorts the booking's payee, always",
  },
  { key: "/", label: "Transactions: go to the text filter" },
  { key: "e", label: "Budget: edit the category's limit; Enter saves, Escape leaves it" },
  { key: "y", label: "Budget: take the suggested limit" },
  { key: "?", label: "Show the keys" },
  { key: "q", label: "Close the pane" },
  { key: "Escape", label: "Stop the always, leave a field, or go back to the editor" },
];
