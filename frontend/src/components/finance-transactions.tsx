import { useQuery } from "@tanstack/react-query";
import { type RefObject, useRef, useState } from "react";
import {
  type BookingLine,
  BookingList,
  SortBar,
  sortKeys,
  type TabKeys,
} from "@/components/finance-sort-bar";
import type { Category } from "@/lib/finance-api";
import { fetchAccounts, fetchTransactions, type Transaction } from "@/lib/finance-budget-api";
import { money } from "@/lib/finance-words";
import type { CategorySort, SortRow } from "@/lib/use-category-sort";

/** The category a booking shows: its own, its splits' when it has them, or why it has none. */
function categoryWords(booking: Transaction, names: Map<number, string>): string {
  if (booking.transfer_group != null) return "Transfer";
  if (booking.splits.length > 0) {
    const parts = booking.splits.map((part) =>
      part.category_id == null ? "Not sorted" : (names.get(part.category_id) ?? "?"),
    );
    return [...new Set(parts)].join(", ");
  }
  return booking.category_id == null ? "Not sorted" : (names.get(booking.category_id) ?? "?");
}

function lineOf(booking: Transaction, names: Map<number, string>): BookingLine {
  return {
    key: `t${booking.id}`,
    date: booking.booking_date,
    who: booking.counterparty_name ?? "No payee",
    amount: booking.amount,
    currency: booking.currency,
    text: booking.purpose ?? "",
    category: categoryWords(booking, names),
  };
}

/** A booking sorts by hand when it is neither a transfer nor split; a split booking sorts on its splits. */
function sortRowOf(booking: Transaction | undefined): SortRow | undefined {
  if (booking === undefined || booking.transfer_group != null || booking.splits.length > 0)
    return undefined;
  return { transaction: booking.id, payee: booking.payee_id };
}

interface Filters {
  account?: number;
  category?: number;
  text: string;
}

function FilterRow({
  filters,
  onChange,
  categories,
  text,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  categories: Category[];
  text: RefObject<HTMLInputElement | null>;
}) {
  const accounts = useQuery({ queryKey: ["finance", "accounts"], queryFn: fetchAccounts });
  const number = (value: string) => (value === "" ? undefined : Number(value));
  return (
    <search aria-label="Filter the bookings" className="finance-filters">
      <select
        aria-label="Account"
        value={filters.account ?? ""}
        onChange={(event) => onChange({ ...filters, account: number(event.target.value) })}
      >
        <option value="">Every account</option>
        {(accounts.data ?? []).map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Category"
        value={filters.category ?? ""}
        onChange={(event) => onChange({ ...filters, category: number(event.target.value) })}
      >
        <option value="">Every category</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <input
        ref={text}
        type="search"
        aria-label="Text"
        placeholder="Payee or purpose  /"
        value={filters.text}
        onChange={(event) => onChange({ ...filters, text: event.target.value })}
      />
    </search>
  );
}

/**
 * The month's bookings, newest first, narrowed by account, category and text. The cursor's
 * booking sorts by the same keys and buttons as the to-sort list; `/` goes to the text field.
 */
export function FinanceTransactions({
  month,
  category,
  sorter,
  keys,
}: {
  month: string;
  /** The category the list opens on, such as one the overview's sankey was pressed on. */
  category?: number;
  sorter: CategorySort;
  keys: RefObject<TabKeys | null>;
}) {
  const [filters, setFilters] = useState<Filters>({ text: "", category });
  const [cursor, setCursor] = useState(0);
  const text = useRef<HTMLInputElement>(null);
  const filter = {
    month,
    account: filters.account,
    category: filters.category,
    text: filters.text.trim(),
  };
  const bookings = useQuery({
    queryKey: ["finance", "transactions", filter],
    queryFn: () => fetchTransactions(filter),
    placeholderData: (previous) => previous,
  });
  const names = new Map(
    (sorter.categories.data ?? []).map((category) => [category.id, category.name]),
  );
  const found = bookings.data ?? [];
  const at = Math.max(0, Math.min(cursor, found.length - 1));
  const row = sortRowOf(found[at]);
  const sorting = sortKeys(sorter, row, (step) =>
    setCursor(Math.max(0, Math.min(at + step, found.length - 1))),
  );
  keys.current = (key) => {
    if (key !== "/") return sorting(key);
    text.current?.focus();
    return true;
  };

  const total = found.reduce((sum, booking) => sum + Number(booking.amount), 0);
  return (
    <>
      <FilterRow
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          setCursor(0);
        }}
        categories={sorter.categories.data ?? []}
        text={text}
      />
      {bookings.error ? <p role="alert">{bookings.error.message}</p> : null}
      <p className="finance-pane-count">
        {bookings.data === undefined
          ? ""
          : `${found.length} ${found.length === 1 ? "booking" : "bookings"}, ${money(total)} net`}
      </p>
      {/* Folded: the month's bookings are what this tab is for, and the category keys work
          while it is closed. */}
      <details className="finance-sums finance-sort-fold">
        <summary>Sort the booking under the cursor</summary>
        <SortBar sorter={sorter} row={row} />
      </details>
      {bookings.data !== undefined && found.length === 0 ? (
        <p className="finance-pane-empty">No bookings match.</p>
      ) : null}
      <BookingList
        label="Bookings"
        lines={found.map((booking) => lineOf(booking, names))}
        at={at}
        onPick={setCursor}
      />
    </>
  );
}
