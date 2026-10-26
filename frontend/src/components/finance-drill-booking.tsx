import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { amountOf } from "@/components/finance-budget-tab";
import {
  categoryNames,
  type DrillProps,
  useWrite,
  Waiting,
} from "@/components/finance-drill-parts";
import { SortBar, sortKeys } from "@/components/finance-sort-bar";
import { sortByHand } from "@/lib/finance-api";
import type { Transaction } from "@/lib/finance-budget-api";
import { type BookingDrill, fetchBookingDrill, writeSplits } from "@/lib/finance-drill-api";
import { money, monthName } from "@/lib/finance-words";

/** The words for the part of the budget a booking counts in. */
const PARTS: Record<string, string> = {
  income: "income",
  fixed: "fixed",
  flexible: "flexible",
  non_monthly: "non-monthly",
  reserve: "paid from a plan's reserve",
  saved: "saved",
  unsorted: "not sorted",
  other_scope: "the move between mine and household",
};

interface Part {
  amount: string;
  text: string;
}

/** The cents of a typed amount, or NaN for one that is no number. */
function cents(text: string): number {
  return Math.round(Number(amountOf(text) ?? "x") * 100);
}

/**
 * A booking's splits as rows of amount and text, signed as the booking is. Saving refuses a set
 * that does not add up to the booking, as the route does; no rows makes the booking whole again.
 */
function Splits({
  booking,
  onSave,
}: {
  booking: Transaction;
  onSave: (parts: { amount: string; text: string | null }[]) => Promise<void>;
}) {
  const [parts, setParts] = useState<Part[]>(
    booking.splits.map((s) => ({ amount: s.amount, text: s.text ?? "" })),
  );
  const whole = Math.round(Number(booking.amount) * 100);
  const sum = parts.reduce((total, part) => total + cents(part.amount), 0);
  const left = (whole - (Number.isNaN(sum) ? 0 : sum)) / 100;
  const even = parts.length === 0 || sum === whole;
  const change = (index: number, field: keyof Part, value: string) =>
    setParts(parts.map((part, at) => (at === index ? { ...part, [field]: value } : part)));
  return (
    <section aria-label="Splits" className="finance-drill-splits">
      {parts.map((part, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a part is its place until it is saved.
        <div key={index} className="finance-drill-split">
          <input
            inputMode="decimal"
            aria-label={`Part ${index + 1} amount`}
            value={part.amount}
            onChange={(event) => change(index, "amount", event.target.value)}
          />
          <input
            aria-label={`Part ${index + 1} text`}
            placeholder="what it was"
            value={part.text}
            onChange={(event) => change(index, "text", event.target.value)}
          />
          <button
            type="button"
            className="finance-pane-button"
            aria-label={`Remove part ${index + 1}`}
            onClick={() => setParts(parts.filter((_, at) => at !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="finance-pane-categories">
        <button
          type="button"
          className="finance-pane-button"
          onClick={() => setParts([...parts, { amount: left.toFixed(2), text: "" }])}
        >
          Add a part
        </button>
        <button
          type="button"
          className="finance-pane-button"
          disabled={!even}
          onClick={() =>
            void onSave(
              parts.map((part) => ({
                amount: (cents(part.amount) / 100).toFixed(2),
                text: part.text.trim() || null,
              })),
            )
          }
        >
          {parts.length === 0 ? "Save, whole" : "Save the splits"}
        </button>
      </div>
      <p className={even ? "overview-caption" : "overview-caption finance-danger"}>
        {even ? "the parts add up to the booking" : `${money(left)} still to share out`}
      </p>
    </section>
  );
}

/** Each field of a booking as a row; the account, payee and category open their own view. */
function Fields({
  data,
  names,
  onOpen,
}: { data: BookingDrill } & Pick<DrillProps, "onOpen"> & {
    names: Map<number, string>;
  }) {
  const { transaction: t, account, payee } = data;
  const rows: [string, string | null | undefined][] = [
    ["Booked", t.booking_date],
    ["Value date", t.value_date],
    ["Counterparty", t.counterparty_name],
    ["Counterparty IBAN", t.counterparty_iban],
    ["Purpose", t.purpose],
    ["Posting text", t.posting_text],
    ["Bank reference", t.bank_ref],
    ["Currency", t.currency],
    ["Source key", t.source_key],
    ["Imported", t.imported_at.slice(0, 16).replace("T", " ")],
    ["Sorted by", t.category_set_by],
  ];
  const category = t.category_id;
  return (
    <dl className="finance-drill-fields">
      <dt>Account</dt>
      <dd>
        <button
          type="button"
          className="finance-crumb"
          onClick={() => onOpen({ kind: "account", id: account.id, name: account.name })}
        >
          {`${account.name} ›`}
        </button>
      </dd>
      {payee == null ? null : (
        <>
          <dt>Payee</dt>
          <dd>
            <button
              type="button"
              className="finance-crumb"
              onClick={() => onOpen({ kind: "payee", id: payee.id, name: payee.name })}
            >
              {`${payee.name} ›`}
            </button>
          </dd>
        </>
      )}
      {category == null ? null : (
        <>
          <dt>Category</dt>
          <dd>
            <button
              type="button"
              className="finance-crumb"
              onClick={() =>
                onOpen({ kind: "category", id: category, name: names.get(category) ?? "Category" })
              }
            >
              {`${names.get(category) ?? "?"} ›`}
            </button>
          </dd>
        </>
      )}
      {rows
        .filter(([, value]) => value != null && value !== "")
        .map(([name, value]) => (
          <div key={name} className="finance-drill-field">
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/**
 * One booking whole: every field and its raw record, where it counts in the budget, its twin and
 * the plan it met, its splits to edit, and the category buttons and keys to sort it again.
 */
export function DrillBooking({ id, onOpen, sorter, keys, onNotice }: DrillProps & { id: number }) {
  const write = useWrite(onNotice);
  const drill = useQuery({
    queryKey: ["finance", "drill", "booking", id],
    queryFn: () => fetchBookingDrill(id),
  });
  const data = drill.data;
  const t = data?.transaction;
  const row =
    t === undefined || t.transfer_group != null || t.splits.length > 0
      ? undefined
      : { transaction: t.id, payee: t.payee_id };
  // After the hooks: the keys sort the booking as the to-sort list's do.
  keys.current = sortKeys(sorter, row, () => undefined);
  if (data === undefined || t === undefined) return <Waiting error={drill.error} />;
  const names = categoryNames(sorter);

  const save = (parts: { amount: string; text: string | null }[]) =>
    write(() => writeSplits(id, parts));

  return (
    <div className="finance-drill">
      <div className="finance-cards">
        <article className="overview-card">
          <h3 className="overview-name">{t.counterparty_name ?? "Booking"}</h3>
          <p className="overview-figure">{money(t.amount, t.currency)}</p>
          <Fields data={data} names={names} onOpen={onOpen} />
          <details className="finance-sums">
            <summary>Raw record</summary>
            <pre className="finance-drill-raw">{JSON.stringify(t.raw, null, 2)}</pre>
          </details>
        </article>
        <article className="overview-card">
          <h3 className="overview-name">Where it counts</h3>
          <ul className="finance-drill-notes">
            {data.counts.length === 0 ? (
              <li>
                {t.transfer_group != null
                  ? "nowhere: a move inside one scope, or the saving account's half of a move"
                  : "nowhere: ignored, money in not sorted yet, or on a saving account"}
              </li>
            ) : null}
            {data.counts.map((count) => (
              <li key={`${count.month}-${count.scope}-${count.part}-${count.category_id}`}>
                {[
                  monthName(count.month),
                  count.scope,
                  PARTS[count.part] ?? count.part,
                  count.category_id == null ? "" : names.get(count.category_id),
                  money(count.amount),
                ]
                  .filter(Boolean)
                  .join(", ")}
              </li>
            ))}
            {data.plans.map((plan) => (
              <li
                key={`plan-${plan.id}`}
              >{`met plan ${plan.name} for ${monthName(plan.period)}`}</li>
            ))}
          </ul>
          {data.twin == null ? null : (
            <button
              type="button"
              className="finance-pane-button"
              onClick={() =>
                onOpen({ kind: "booking", id: data.twin?.id ?? id, name: "Other half" })
              }
            >
              {`Other half: ${money(data.twin.amount)} ›`}
            </button>
          )}
        </article>
        <article className="overview-card finance-wide-card">
          <h3 className="overview-name">Sort</h3>
          {row === undefined ? null : <SortBar sorter={sorter} row={row} />}
          {t.splits.map((split, index) => (
            <label key={split.id} className="finance-drill-split-sort">
              {`Part ${index + 1}, ${money(split.amount)}${split.text ? `, ${split.text}` : ""}`}
              <select
                value={split.category_id ?? ""}
                onChange={(event) =>
                  void write(() =>
                    sortByHand({ transaction: t.id, split: split.id }, Number(event.target.value)),
                  )
                }
              >
                <option value="" disabled>
                  Not sorted
                </option>
                {(sorter.categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {t.transfer_group != null ? (
            <p className="overview-caption">a move between own accounts takes no category</p>
          ) : (
            <Splits key={t.splits.map((s) => s.id).join()} booking={t} onSave={save} />
          )}
        </article>
      </div>
    </div>
  );
}
