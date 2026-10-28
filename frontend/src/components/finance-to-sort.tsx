import { useQuery } from "@tanstack/react-query";
import { type RefObject, useState } from "react";
import { UnmatchedOrders } from "@/components/finance-orders";
import { ReceiptsToSort } from "@/components/finance-receipts";
import { BookingList, SortBar, sortKeys, type TabKeys } from "@/components/finance-sort-bar";
import { fetchToSort, type ToSort } from "@/lib/finance/finance-api";
import type { CategorySort } from "@/lib/finance/use-category-sort";

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

/**
 * The to-sort list: every booking or split without a category, oldest first. A key or a button
 * per category sorts the cursor's row; with "always" armed it sorts the row's payee instead.
 * Under it, the receipts on no booking, and the PayPal and Amazon orders no booking holds yet.
 */
export function FinanceToSort({
  sorter,
  keys,
  onNotice,
}: {
  sorter: CategorySort;
  keys: RefObject<TabKeys | null>;
  onNotice: (text: string | undefined) => void;
}) {
  const [cursor, setCursor] = useState(0);
  const toSort = useQuery({ queryKey: ["finance", "to-sort"], queryFn: fetchToSort });
  const rows = rowsOf(toSort.data?.bookings ?? []);
  const at = Math.max(0, Math.min(cursor, rows.length - 1));
  const row = rows[at];
  keys.current = sortKeys(sorter, row, (step) =>
    setCursor(Math.max(0, Math.min(at + step, rows.length - 1))),
  );

  return (
    <>
      <p className="finance-pane-count">
        {toSort.data === undefined ? "" : `${toSort.data.total} to sort`}
      </p>
      {toSort.error ? <p role="alert">{toSort.error.message}</p> : null}
      <SortBar sorter={sorter} row={row} />
      {toSort.data !== undefined && rows.length === 0 ? (
        <p className="finance-pane-empty">Nothing to sort.</p>
      ) : null}
      <BookingList label="Bookings to sort" lines={rows} at={at} onPick={setCursor} />
      <ReceiptsToSort onNotice={onNotice} />
      <UnmatchedOrders />
    </>
  );
}
