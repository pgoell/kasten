import { useQueryClient } from "@tanstack/react-query";
import { type RefObject, useState } from "react";
import { BookingList, type TabKeys } from "@/components/finance-sort-bar";
import type { Transaction } from "@/lib/finance-budget-api";
import type { DrillStep } from "@/lib/finance-drill-api";
import { euros, money } from "@/lib/finance-words";
import type { CategorySort } from "@/lib/use-category-sort";

/** What every drilldown view is handed: where it is, and how to go further down. */
export interface DrillProps {
  month: string;
  today: string;
  /** Opens one step further down, on top of the trail. */
  onOpen: (step: DrillStep) => void;
  onMonth: (month: string) => void;
  sorter: CategorySort;
  keys: RefObject<TabKeys | null>;
  onNotice: (text: string | undefined) => void;
}

/** A name with its amount as a row that opens it, or a plain row when there is nothing to open. */
export function AmountRows({
  label,
  rows,
  signed = false,
}: {
  label: string;
  rows: { key: string; name: string; amount: string | number; open?: () => void }[];
  /** Write the amounts with their sign, as bookings are, rather than as positive figures. */
  signed?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <ul aria-label={label} className="finance-drill-rows">
      {rows.map((row) => (
        <li key={row.key}>
          {row.open === undefined ? (
            <span className="finance-drill-row">
              <span>{row.name}</span>
              <span className="finance-pane-amount">
                {signed ? money(row.amount) : euros(row.amount)}
              </span>
            </span>
          ) : (
            <button type="button" className="finance-drill-row" onClick={row.open}>
              <span>{row.name} ›</span>
              <span className="finance-pane-amount">
                {signed ? money(row.amount) : euros(row.amount)}
              </span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The category a booking shows: its own, its splits', a transfer's, or "Not sorted". */
export function categoryOf(booking: Transaction, names: Map<number, string>): string {
  if (booking.transfer_group != null) return "Transfer";
  const ids =
    booking.splits.length > 0 ? booking.splits.map((s) => s.category_id) : [booking.category_id];
  const words = ids.map((id) => (id == null ? "Not sorted" : (names.get(id) ?? "?")));
  return [...new Set(words)].join(", ");
}

/**
 * The bookings of a drilldown, newest first. A tap opens one; `j` and `k` move the cursor and
 * Enter opens the cursor's booking. `keys` takes those, and hands the rest on to `more`.
 */
export function DrillBookings({
  bookings,
  names,
  onOpen,
  keys,
  more,
}: {
  bookings: Transaction[];
  names: Map<number, string>;
  onOpen: (step: DrillStep) => void;
  keys: RefObject<TabKeys | null>;
  more?: TabKeys;
}) {
  const [cursor, setCursor] = useState(0);
  const at = Math.max(0, Math.min(cursor, bookings.length - 1));
  const open = (booking: Transaction | undefined) => {
    if (booking !== undefined)
      onOpen({ kind: "booking", id: booking.id, name: booking.counterparty_name ?? "Booking" });
  };
  keys.current = (key) => {
    if (key === "j" || key === "k") {
      setCursor(Math.max(0, Math.min(at + (key === "j" ? 1 : -1), bookings.length - 1)));
      return true;
    }
    if (key === "Enter") {
      open(bookings[at]);
      return true;
    }
    return more?.(key) ?? false;
  };
  const total = bookings.reduce((sum, booking) => sum + Number(booking.amount), 0);
  return (
    <section aria-label="Bookings" className="finance-drill-bookings">
      <h3 className="overview-name">
        {`${bookings.length} ${bookings.length === 1 ? "booking" : "bookings"}, ${money(total)} net`}
      </h3>
      <BookingList
        label="Bookings"
        lines={bookings.map((booking) => ({
          key: `t${booking.id}`,
          date: booking.booking_date,
          who: booking.counterparty_name ?? "No payee",
          amount: booking.amount,
          currency: booking.currency,
          text: booking.purpose ?? "",
          category: categoryOf(booking, names),
        }))}
        at={at}
        onPick={(index) => {
          setCursor(index);
          open(bookings[index]);
        }}
      />
    </section>
  );
}

/** Every category's name by id, from the categories the sorter already reads. */
export function categoryNames(sorter: CategorySort): Map<number, string> {
  return new Map((sorter.categories.data ?? []).map((category) => [category.id, category.name]));
}

/** What a drilldown shows before its answer is in, or when the answer failed. */
export function Waiting({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert">{error.message}</p>
  ) : (
    <p className="finance-pane-empty">loading</p>
  );
}

/**
 * A write a drilldown makes: its refusal goes to the notice line, and every finance read goes
 * stale after it, since a sort or a split moves money between the budget's categories.
 */
export function useWrite(onNotice: (text: string | undefined) => void) {
  const queries = useQueryClient();
  return async (what: () => Promise<void>) => {
    try {
      await what();
      onNotice(undefined);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      onNotice(error.message);
    }
    await queries.invalidateQueries({ queryKey: ["finance"] });
  };
}
