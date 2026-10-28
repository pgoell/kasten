import { CATEGORY_KEYS } from "@/lib/finance/finance-keys";
import { categoryColour, money } from "@/lib/finance/finance-words";
import type { CategorySort, SortRow } from "@/lib/finance/use-category-sort";

/** A key handler a tab of the finance pane hands the frame; true when it took the key. */
export type TabKeys = (key: string) => boolean;

/**
 * The "always for this payee" switch and a button per category, each with its key, sorting
 * `row`. The to-sort list and the transactions list share it, so a key means the same in both.
 */
export function SortBar({ sorter, row }: { sorter: CategorySort; row: SortRow | undefined }) {
  const { categories, always, setAlways, busy, sort } = sorter;
  return (
    <div role="toolbar" aria-label="Categories" className="finance-pane-categories">
      <button
        type="button"
        className="finance-pane-button"
        aria-pressed={always}
        onClick={() => setAlways(!always)}
      >
        <kbd>a</kbd> Always for this payee
      </button>
      {(categories.data ?? []).map((category, index) => (
        <button
          key={category.id}
          type="button"
          className="finance-pane-button"
          disabled={row === undefined || busy}
          onClick={() => void sort(row, category)}
        >
          {index < CATEGORY_KEYS.length ? <kbd>{CATEGORY_KEYS[index]}</kbd> : null} {category.name}
        </button>
      ))}
    </div>
  );
}

/**
 * The keys a sorting list takes: a category key sorts the row, `a` arms "always", `j` and `k`
 * move, and Escape stops an armed "always". Anything else is left to the frame.
 */
export function sortKeys(
  sorter: CategorySort,
  row: SortRow | undefined,
  move: (step: number) => void,
): TabKeys {
  return (key) => {
    const category = sorter.categoryOf(key);
    if (category !== undefined) {
      void sorter.sort(row, category);
      return true;
    }
    if (key === "j" || key === "k") {
      move(key === "j" ? 1 : -1);
      return true;
    }
    if (key === "a") {
      sorter.setAlways(!sorter.always);
      return true;
    }
    if (key === "Escape" && sorter.always) {
      sorter.setAlways(false);
      return true;
    }
    return false;
  };
}

/** A booking or split as a list shows it. */
export interface BookingLine {
  key: string;
  date: string;
  who: string;
  amount: string;
  /** EUR unless the booking says otherwise. */
  currency?: string;
  text: string;
  /** The category's name, where the list shows one; "Not sorted" or "Transfer" otherwise. */
  category?: string;
}

/**
 * The bookings of a list, the cursor's row marked; a tap moves the cursor there. Date, payee
 * and amount on the first line, the purpose (and the category) under them.
 */
export function BookingList({
  label,
  lines,
  at,
  onPick,
}: {
  label: string;
  lines: BookingLine[];
  at: number;
  onPick: (index: number) => void;
}) {
  return (
    <ul aria-label={label} className="finance-pane-list">
      {lines.map((item, index) => (
        // The cursor's row is marked with aria-selected, which a list item does not take by role.
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the cursor row is the one marked, as the log pane's is.
        <li
          key={item.key}
          aria-selected={index === at}
          className={index === at ? "finance-pane-row finance-pane-selected" : "finance-pane-row"}
        >
          <button type="button" className="finance-pane-line" onClick={() => onPick(index)}>
            <span className="finance-pane-date">{item.date}</span>
            <span className="finance-pane-who">{item.who}</span>
            <span className="finance-pane-amount">{money(item.amount, item.currency)}</span>
            <span className="finance-pane-text">{item.text}</span>
            {item.category === undefined ? null : (
              <span
                className="finance-pane-tag"
                style={{ "--finance-dot": categoryColour(item.category) } as React.CSSProperties}
              >
                {item.category}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
