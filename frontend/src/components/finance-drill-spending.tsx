import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  AmountRows,
  categoryNames,
  DrillBookings,
  type DrillProps,
  useWrite,
  Waiting,
} from "@/components/finance-drill-parts";
import { MonthChart } from "@/components/finance-month-chart";
import { sortPayee } from "@/lib/finance-api";
import {
  type CategoryDrill,
  fetchCategoryDrill,
  fetchPayeeDrill,
  type PayeeDrill,
  writePayeeRule,
} from "@/lib/finance-drill-api";
import { euros, monthName } from "@/lib/finance-words";

/** How often a plan falls due, in words. */
function every(months: number | null | undefined): string {
  if (months == null) return "once";
  if (months === 1) return "monthly";
  return months === 12 ? "yearly" : `every ${months} months`;
}

/** A category's span in one line: its figure, a year before, the average and what was available. */
function spanWords(data: CategoryDrill, label: string): string {
  const { now, last_year: before, average, available } = data.span;
  return [
    `${label}: ${euros(now.total)}`,
    before == null ? "no data a year before" : `a year before ${euros(before.total)}`,
    average == null ? "no average yet" : `6-month average ${euros(average.total)}`,
    available == null ? "" : `${euros(available)} available`,
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * One category: what it counted each month as bars against its limit, with its average, the
 * month's payees, the plans and rules behind it and the month's bookings. The figures are the
 * budget's, so a month's bar is the category's spent on the budget tab.
 */
export function DrillCategory({
  span,
  spanLabel,
  id,
  month,
  onOpen,
  onMonth,
  sorter,
  keys,
}: DrillProps & { id: number }) {
  const drill = useQuery({
    queryKey: ["finance", "drill", "category", id, span],
    queryFn: () => fetchCategoryDrill(id, span),
    // The view stays while the next month loads, so the focus and the keys stay with it.
    placeholderData: (previous) => previous,
  });
  const data = drill.data;
  // The month shown, whose limit the dashed line is; the span's last when it is not in the chart.
  const row = data?.months.find((m) => m.month === month) ?? data?.months.at(-1);
  if (data === undefined || row === undefined) return <Waiting error={drill.error} />;
  const { category } = data;
  const now = data.span.now;
  const income = category.kind === "income";
  const limit = row.available == null ? undefined : Number(row.available);
  return (
    <div className="finance-drill">
      <div className="finance-cards">
        <article className="overview-card finance-wide-card">
          <h3 className="overview-name">{`${category.name}, ${income ? "money in" : "spent"} per month`}</h3>
          <MonthChart
            months={data.months.map((m) => m.month)}
            values={data.months.map((m) => Number(m.total))}
            goal={limit}
            month={month}
            onPick={onMonth}
            label={`${category.name} over ${data.months.length} months${limit === undefined ? "" : `, the dashed line is ${euros(limit)} available`}`}
            hitLabel={(index) => {
              const at = data.months[index];
              return at === undefined ? "" : `${monthName(at.month)}, ${euros(at.total)}`;
            }}
            readout={(index) => {
              const at = data.months[index];
              if (at === undefined) return null;
              return (
                <>
                  <span>{monthName(at.month)}</span> <strong>{euros(at.total)}</strong>
                  <span className="finance-muted">
                    {at.available == null ? "" : ` of ${euros(at.available)}`}
                    {at.average == null ? "" : `, average ${euros(at.average)}`}
                  </span>
                </>
              );
            }}
          />
          <p className="overview-words">{spanWords(data, spanLabel)}</p>
          <p className="overview-caption">
            {category.kind === "ignore"
              ? "an ignored category counts nowhere; its bookings are below"
              : [
                  `${spanLabel}: mine ${euros(now.mine)}, household ${euros(now.household)}`,
                  Number(now.from_reserve) > 0
                    ? `${euros(now.from_reserve)} of it paid from a plan's reserve`
                    : "",
                  limit === undefined
                    ? "no limit set"
                    : `the dashed line is what ${monthName(row.month)} had available`,
                ]
                  .filter(Boolean)
                  .join("; ")}
          </p>
        </article>
        <article className="overview-card">
          <h3 className="overview-name">{`Payees in ${spanLabel}`}</h3>
          {data.payees.length === 0 ? <p className="overview-words">none this month</p> : null}
          <AmountRows
            label="Payees"
            rows={data.payees.slice(0, 10).map((payee) => ({
              key: String(payee.id),
              name: payee.name,
              amount: payee.amount,
              open:
                payee.id == null
                  ? undefined
                  : () => onOpen({ kind: "payee", id: payee.id as number, name: payee.name }),
            }))}
          />
        </article>
        <article className="overview-card">
          <h3 className="overview-name">Plans and rules</h3>
          {data.plans.length + data.rules.length === 0 ? (
            <p className="overview-words">no plan or rule books into it</p>
          ) : null}
          <ul className="finance-drill-notes">
            {data.plans.map((plan) => (
              <li key={`p${plan.id}`}>
                {`plan ${plan.name}, ${euros(Math.abs(Number(plan.amount)))} ${every(plan.every_months)}`}
              </li>
            ))}
            {data.rules.map((rule) => (
              <li key={`r${rule.id}`}>
                {rule.kind === "payee"
                  ? `rule: payee starts with “${rule.pattern}”`
                  : `rule: text holds “${rule.pattern}”`}
              </li>
            ))}
          </ul>
        </article>
      </div>
      <DrillBookings
        bookings={data.bookings}
        names={categoryNames(sorter)}
        onOpen={onOpen}
        keys={keys}
        category={id}
      />
    </div>
  );
}

/** The line under a payee's chart: its average, a booking's size, and what moved to saving. */
function payeeWords(data: PayeeDrill, row: PayeeDrill["months"][number], paysIn: boolean): string {
  const average = paysIn ? data.average_received : data.average;
  return [
    average == null ? "no average yet" : `average ${euros(average)} a month`,
    row.bookings > 0 && !paysIn
      ? `${euros(Number(row.spent) / row.bookings)} a booking in ${monthName(row.month)}`
      : "",
    Number(row.saved) > 0 ? `${euros(row.saved)} moved to saving` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * One payee: its spending each month as bars, how often and how much on average, the categories
 * its money went to, its default category and rules, and the month's bookings. A move between own
 * accounts is never spending here, as it is nowhere in the budget.
 */
export function DrillPayee({
  span,
  spanLabel,
  id,
  month,
  onOpen,
  onMonth,
  sorter,
  keys,
  onNotice,
}: DrillProps & { id: number }) {
  const write = useWrite(onNotice);
  const [choice, setChoice] = useState<number>();
  const drill = useQuery({
    queryKey: ["finance", "drill", "payee", id, span],
    queryFn: () => fetchPayeeDrill(id, span),
    // The view stays while the next month loads, so the focus and the keys stay with it.
    placeholderData: (previous) => previous,
  });
  const data = drill.data;
  const row = data?.months.find((m) => m.month === month) ?? data?.months.at(-1);
  if (data === undefined || row === undefined) return <Waiting error={drill.error} />;
  const { payee } = data;
  // A payee that only pays in, such as an employer, is drawn by what it paid.
  const paysIn = data.months.every((m) => Number(m.spent) === 0);
  const figure = (m: (typeof data.months)[number]) => Number(paysIn ? m.received : m.spent);
  const names = categoryNames(sorter);
  const inSpan = data.months.filter((m) => m.month >= span.from && m.month <= span.to);
  const spanFigure = inSpan.reduce((sum, m) => sum + figure(m), 0);
  const spanCount = inSpan.reduce((sum, m) => sum + m.bookings, 0);
  const chosen = choice ?? payee.category_id ?? undefined;

  return (
    <div className="finance-drill">
      <div className="finance-cards">
        <article className="overview-card finance-wide-card">
          <h3 className="overview-name">{`${payee.name}, ${paysIn ? "money in" : "spent"} per month`}</h3>
          <MonthChart
            months={data.months.map((m) => m.month)}
            values={data.months.map(figure)}
            month={month}
            onPick={onMonth}
            label={`${payee.name} over ${data.months.length} months`}
            hitLabel={(index) => {
              const at = data.months[index];
              return at === undefined
                ? ""
                : `${monthName(at.month)}, ${euros(figure(at))}, ${at.bookings} bookings`;
            }}
            readout={(index) => {
              const at = data.months[index];
              if (at === undefined) return null;
              return (
                <>
                  <span>{monthName(at.month)}</span> <strong>{euros(figure(at))}</strong>
                  <span className="finance-muted">{` in ${at.bookings} ${at.bookings === 1 ? "booking" : "bookings"}`}</span>
                </>
              );
            }}
          />
          <p className="overview-words">
            {`${spanLabel}: ${euros(spanFigure)} in ${spanCount} ${spanCount === 1 ? "booking" : "bookings"}`}
          </p>
          <p className="overview-caption">{payeeWords(data, row, paysIn)}</p>
        </article>
        <article className="overview-card">
          <h3 className="overview-name">{`Categories over ${data.months.length} months`}</h3>
          {data.categories.length === 0 ? <p className="overview-words">none sorted yet</p> : null}
          <AmountRows
            label="Categories"
            rows={data.categories.map((c) => ({
              key: String(c.id),
              name: c.name,
              amount: c.amount,
              open: () => onOpen({ kind: "category", id: c.id as number, name: c.name }),
            }))}
          />
        </article>
        <article className="overview-card">
          <h3 className="overview-name">Sorting</h3>
          <p className="overview-words">
            {payee.category_id == null
              ? "no default category"
              : `default: ${names.get(payee.category_id) ?? "?"}`}
          </p>
          <select
            aria-label={`Category for ${payee.name}`}
            value={chosen ?? ""}
            onChange={(event) => setChoice(Number(event.target.value) || undefined)}
          >
            <option value="">Pick a category</option>
            {(sorter.categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <div className="finance-pane-categories">
            <button
              type="button"
              className="finance-pane-button"
              disabled={chosen === undefined}
              onClick={() =>
                chosen === undefined ? undefined : void write(() => sortPayee(payee.id, chosen))
              }
            >
              Make it the default
            </button>
            <button
              type="button"
              className="finance-pane-button"
              disabled={chosen === undefined}
              onClick={() =>
                chosen === undefined
                  ? undefined
                  : void write(() => writePayeeRule(payee.key, chosen))
              }
            >
              Add a rule
            </button>
          </div>
          <ul className="finance-drill-notes">
            {data.rules.map((rule) => (
              <li key={rule.id}>
                {`rule: payee starts with “${rule.pattern}”, into ${names.get(rule.category_id) ?? "?"}`}
              </li>
            ))}
          </ul>
          <p className="overview-caption">
            the default sorts this payee's bookings; a rule sorts every payee whose name starts with
            “{payee.key}”
          </p>
        </article>
      </div>
      <DrillBookings bookings={data.bookings} names={names} onOpen={onOpen} keys={keys} />
    </div>
  );
}
