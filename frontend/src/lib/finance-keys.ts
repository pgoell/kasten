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

export type FinanceTab = "overview" | "to-sort" | "transactions" | "budget" | "plans";

/** The pane's five tabs, in order, each with the key that shows it. Upper case, as the lower keys sort. */
export const FINANCE_TABS: readonly { tab: FinanceTab; label: string; key: string }[] = [
  { tab: "overview", label: "Overview", key: "O" },
  { tab: "to-sort", label: "To sort", key: "S" },
  { tab: "transactions", label: "Transactions", key: "T" },
  { tab: "budget", label: "Budget", key: "B" },
  { tab: "plans", label: "Plans & goals", key: "G" },
];

/** What the keys do inside the finance pane. Display only, the way `TODO_PANE` in `key-bindings.ts` is. */
export const FINANCE_PANE: readonly { key: string; label: string }[] = [
  { key: "O", label: "Show the overview" },
  { key: "S", label: "Show the bookings to sort" },
  { key: "T", label: "Show the transactions" },
  { key: "B", label: "Show the budget" },
  { key: "G", label: "Show the plans and goals" },
  { key: "[", label: "Show the month before" },
  { key: "]", label: "Show the month after" },
  { key: "P", label: "Pull now: ask the bank job for a pull" },
  { key: "j", label: "Move to the next booking, category or goal" },
  { key: "k", label: "Move to the previous booking, category or goal" },
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
  { key: "Enter", label: "Transactions and drilldowns: open the booking under the cursor" },
  {
    key: "1",
    label: "A booking's drilldown: sort the booking into that category, as on the to-sort list",
  },
  { key: "e", label: "Budget: edit the category's limit; Enter saves, Escape leaves it" },
  { key: "y", label: "Budget: take the suggested limit" },
  { key: "s", label: "Budget: set up every limit on one screen" },
  { key: "u", label: "Budget setup: fill every field with its suggestion" },
  { key: "1", label: "Plans & goals: confirm the proposed plan with that key, 1 to 9" },
  { key: "n", label: "Plans & goals: make a new plan" },
  { key: "g", label: "Plans & goals: make a new goal" },
  {
    key: "a",
    label:
      "Plans & goals: assign this month's contribution of the account's balance to the goal, once",
  },
  { key: "u", label: "Plans & goals: undo the contribution assigned this month" },
  { key: "e", label: "Plans & goals: edit the goal; Enter saves, Escape leaves it" },
  { key: "?", label: "Show the keys" },
  { key: "q", label: "Close the pane" },
  {
    key: "Escape",
    label: "Stop the always, leave a field, step back out of a drilldown, or go back to the editor",
  },
];
