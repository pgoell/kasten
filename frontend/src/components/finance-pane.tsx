import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  type Category,
  fetchCategories,
  fetchToSort,
  sortByHand,
  sortPayee,
  type ToSort,
} from "@/lib/finance-api";
import { CATEGORY_KEYS } from "@/lib/finance-keys";
import type { EditorCommands } from "@/lib/key-bindings";
import { useLeader } from "@/lib/use-leader";

/** One thing to sort: a booking without splits, or one split of a booking. */
interface Row {
  key: string;
  transaction: number;
  split?: number;
  date: string;
  who: string;
  text: string;
  amount: string;
  currency: string;
  payee: number | null;
}

/** The bookings as rows, a booking's loose splits in its place. */
function rowsOf(bookings: ToSort[]): Row[] {
  return bookings.flatMap((booking) => {
    const shared = {
      transaction: booking.id,
      date: booking.booking_date,
      who: booking.payee_name ?? booking.counterparty_name ?? "No payee",
      currency: booking.currency,
      payee: booking.payee_id,
    };
    if (booking.splits.length === 0) {
      return [
        {
          ...shared,
          key: `t${booking.id}`,
          text: booking.purpose ?? "",
          amount: booking.amount,
        },
      ];
    }
    return booking.splits.map((part) => ({
      ...shared,
      key: `s${part.id}`,
      split: part.id,
      text: part.text ?? "",
      amount: part.amount,
    }));
  });
}

function money(amount: string, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(Number(amount));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Finance did not load";
}

export interface FinancePaneProps {
  /** Reached by a leader sequence typed here, so every leader key still works. */
  commands: EditorCommands;
  /** Raised by the route when this pane has been moved to. See `Editor`. */
  focusSignal: number;
  /** Says why a write was refused, or clears the line with undefined. */
  onNotice: (text: string | undefined) => void;
}

/**
 * The finance pane, for now its to-sort view: every booking or split without a category,
 * oldest first. A key or a button per category sorts the cursor's row; with "always" armed it
 * sorts the row's payee instead, and every booking of theirs a rule may sort goes with it.
 */
export function FinancePane({ commands, focusSignal, onNotice }: FinancePaneProps) {
  const [cursor, setCursor] = useState(0);
  const [always, setAlways] = useState(false);
  // A write in the air. Keys and taps that sort wait for it, or a quick second press would sort
  // the same row again, or the row under it into the category meant for this one.
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const queries = useQueryClient();
  const leader = useLeader(commands);

  const categories = useQuery({ queryKey: ["finance", "categories"], queryFn: fetchCategories });
  const toSort = useQuery({ queryKey: ["finance", "to-sort"], queryFn: fetchToSort });
  const rows = rowsOf(toSort.data?.bookings ?? []);
  const at = Math.max(0, Math.min(cursor, rows.length - 1));
  const row = rows[at];

  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  async function sort(category: Category) {
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
    try {
      await queries.invalidateQueries({ queryKey: ["finance", "to-sort"] });
    } finally {
      setBusy(false);
    }
  }

  /** The category a key sorts into, if it is one of `CATEGORY_KEYS` and that many are listed. */
  function categoryOf(key: string): Category | undefined {
    const index = key.length === 1 ? CATEGORY_KEYS.indexOf(key) : -1;
    return index === -1 ? undefined : categories.data?.[index];
  }

  /** Stops an armed "always" first, and only then hands the keys back to the editor. */
  function leave() {
    if (always) setAlways(false);
    else document.querySelector<HTMLElement>(".cm-content")?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    const { target, key } = event;
    // Enter or Space on a focused button is that button's own press, not the cursor row's.
    if (target instanceof HTMLButtonElement && (key === "Enter" || key === " ")) return;
    if (leader.feed(event)) return;
    // A chord such as Ctrl 1 belongs to the browser or the app, not to a category.
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const category = categoryOf(key);
    if (category !== undefined) {
      void sort(category);
      event.preventDefault();
      return;
    }
    switch (key) {
      case " ":
        leader.start(event);
        break;
      case "j":
        setCursor(Math.min(at + 1, rows.length - 1));
        break;
      case "k":
        setCursor(Math.max(at - 1, 0));
        break;
      case "a":
        setAlways(!always);
        break;
      case "?":
        commands.showHelp();
        break;
      case "q":
        commands.closeNote();
        break;
      case "Escape":
        leave();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const error = categories.error ?? toSort.error;
  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label="Finance"
      onKeyDown={onKeyDown}
      className="finance-pane"
    >
      <header className="finance-pane-head">
        <h2>To sort</h2>
        <span className="finance-pane-count">
          {toSort.data === undefined ? "" : `${toSort.data.total} to sort`}
        </span>
        <button
          type="button"
          className="finance-pane-button"
          aria-pressed={always}
          onClick={() => setAlways(!always)}
        >
          <kbd>a</kbd> Always for this payee
        </button>
      </header>
      {error ? <p role="alert">{messageOf(error)}</p> : null}
      <div role="toolbar" aria-label="Categories" className="finance-pane-categories">
        {(categories.data ?? []).map((category, index) => (
          <button
            key={category.id}
            type="button"
            className="finance-pane-button"
            disabled={row === undefined || busy}
            onClick={() => void sort(category)}
          >
            {index < CATEGORY_KEYS.length ? <kbd>{CATEGORY_KEYS[index]}</kbd> : null}{" "}
            {category.name}
          </button>
        ))}
      </div>
      {toSort.data !== undefined && rows.length === 0 ? (
        <p className="finance-pane-empty">Nothing to sort.</p>
      ) : null}
      <ul aria-label="Bookings to sort" className="finance-pane-list">
        {rows.map((item, index) => (
          // The cursor's row is marked with aria-selected, which a list item does not take by role.
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the cursor row is the one marked, as the log pane's is.
          <li
            key={item.key}
            aria-selected={index === at}
            className={index === at ? "finance-pane-row finance-pane-selected" : "finance-pane-row"}
          >
            <button type="button" className="finance-pane-line" onClick={() => setCursor(index)}>
              <span className="finance-pane-date">{item.date}</span>
              <span className="finance-pane-who">{item.who}</span>
              <span className="finance-pane-amount">{money(item.amount, item.currency)}</span>
              <span className="finance-pane-text">{item.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
