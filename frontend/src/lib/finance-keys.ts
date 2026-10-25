/**
 * The finance pane's keys. Apart from `key-bindings.ts`, which is past the size a reader
 * can take in one go, and beside the keys categories take, which the table names.
 */

/**
 * The keys categories take, in the order the categories are listed. The pane's own keys are
 * left out: `j` and `k` move, `a` arms "always for this payee", `q` closes. A category past
 * the last key is reached by its button only.
 */
export const CATEGORY_KEYS = "1234567890bcdefghilmnoprstuvwxyz";

/** What the keys do inside the finance pane. Display only, the way `TODO_PANE` in `key-bindings.ts` is. */
export const FINANCE_PANE: readonly { key: string; label: string }[] = [
  { key: "j", label: "Move to the next booking" },
  { key: "k", label: "Move to the previous booking" },
  { key: "1", label: "Sort the booking into the first category; each button shows its key" },
  { key: "a", label: "The next category key sorts the booking's payee, always" },
  { key: "?", label: "Show the keys" },
  { key: "q", label: "Close the pane" },
  { key: "Escape", label: "Stop the always, or go back to the editor" },
];
