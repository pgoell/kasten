import { useQuery } from "@tanstack/react-query";
import type { BookingDrill } from "@/lib/finance/finance-drill-api";
import {
  type Charge,
  fetchUnmatchedOrders,
  type Order,
  statusWords,
} from "@/lib/finance/finance-orders-api";
import { money } from "@/lib/finance/finance-words";

const SOURCES: Record<string, string> = { amazon: "Amazon", paypal: "PayPal" };

/** One line per charge that waits, and one for an order with no charge yet. */
function waitingLines(order: Order): { key: string; text: string }[] {
  const head = `${order.ordered_on}, ${order.merchant}`;
  if (order.charges.length === 0) {
    const total = order.total == null ? "" : `, ${money(order.total, order.currency)}`;
    return [{ key: `${order.id}`, text: `${head}${total}: not dispatched yet` }];
  }
  return order.charges
    .filter((charge) => charge.transaction_id == null)
    .map((charge) => ({
      key: `${order.id}-${charge.id}`,
      text: `${head}, ${charge.kind === "refund" ? "refund " : ""}${money(charge.amount, order.currency)}: ${statusWords(charge.status)}`,
    }));
}

/**
 * The PayPal and Amazon orders no booking holds yet, under the to-sort list: why each waits,
 * so a charge whose items do not add up, or that two bookings fit, does not go unseen.
 */
export function UnmatchedOrders() {
  const orders = useQuery({
    queryKey: ["finance", "orders", "unmatched"],
    queryFn: fetchUnmatchedOrders,
  });
  const lines = (orders.data ?? []).flatMap(waitingLines);
  if (orders.error) return <p role="alert">{orders.error.message}</p>;
  if (lines.length === 0) return null;
  return (
    <section aria-label="Orders without a booking">
      <h3 className="overview-name">Orders without a booking</h3>
      <ul className="finance-drill-notes">
        {lines.map((line) => (
          <li key={line.key}>{line.text}</li>
        ))}
      </ul>
    </section>
  );
}

/** What a match did to this booking, in a sentence. */
function outcome(charge: Charge): string {
  if (charge.kind === "refund") return "Money back for this order.";
  if (charge.status === "unsplit") {
    return "You took away the split into these items, so it stays whole.";
  }
  if (charge.status === "kept") {
    return "You had sorted or split this booking by hand, so it stays as you left it. To use the items, split it by hand from them.";
  }
  return "Split into the items below; each is sorted on its own.";
}

/**
 * The PayPal or Amazon order a booking paid or got money back from: the order, what the match
 * did, and this charge's items, or for a refund the order's other charges.
 */
export function BookingOrder({ order }: { order: NonNullable<BookingDrill["order"]> }) {
  const { order: o, charge_id } = order;
  const charge = o.charges.find((c) => c.id === charge_id);
  if (charge === undefined) return null;
  const rows =
    charge.kind === "refund"
      ? o.charges
          .filter((c) => c.id !== charge.id)
          .map((c) => ({
            key: `c${c.id}`,
            text: `${c.kind === "refund" ? "Refund" : "Paid"} ${c.charged_on}`,
            amount: c.amount,
          }))
      : charge.items.map((item, index) => ({
          key: `i${index}`,
          text: item.text,
          amount: item.amount,
        }));
  return (
    <article className="overview-card finance-wide-card">
      <h3 className="overview-name">{`${SOURCES[o.source] ?? o.source} order`}</h3>
      <p className="overview-caption">
        {`${o.merchant}, ${o.order_key}, ordered ${o.ordered_on}${
          o.total == null ? "" : `, ${money(o.total, o.currency)} in all`
        }`}
      </p>
      <p className="overview-caption">{outcome(charge)}</p>
      <table className="finance-drill-table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.text}</th>
              <td>{money(row.amount, o.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
