import { useQuery } from "@tanstack/react-query";
import { BankCard, type Pull } from "@/components/finance-bank";
import { GoalsCard } from "@/components/finance-goals";
import { MoveLeftover } from "@/components/finance-leftover";
import { Meter, statusWords } from "@/components/finance-meter";
import { FinanceSankey } from "@/components/finance-sankey";
import { SpendingTrend } from "@/components/finance-trend";
import {
  type Budget,
  type Free,
  fetchBudget,
  fetchFlow,
  fetchFree,
  fetchTrend,
} from "@/lib/finance-budget-api";
import type { Scope } from "@/lib/finance-drill-api";
import { euros, monthName, percent, shiftMonth } from "@/lib/finance-words";

/** The parts free to spend is made of, in the order the line under it names them. */
const PARTS: { key: "fixed" | "flexible" | "non_monthly"; word: string }[] = [
  { key: "fixed", word: "fixed" },
  { key: "flexible", word: "flexible" },
  { key: "non_monthly", word: "non-monthly" },
];

/** What a part is called when it took money away, and when it gave some back. */
const GAVE_BACK: Record<string, string> = {
  fixed: "fixed refunded",
  flexible: "flexible refunded",
  "non-monthly": "non-monthly refunded",
  "not sorted": "not sorted",
  saved: "taken from saving",
};

/**
 * The line under the figure: `3.450 € income, less 1.247 € fixed, 591 € flexible, 450 € saved`.
 * A part that gave money back, such as savings drawn on, follows as `plus 200 € taken from
 * saving`, so no amount reads as a double negative.
 */
export function madeOf(free: Free): string {
  const parts = [
    ...PARTS.map(({ key, word }) => ({ amount: Number(free[key].total), word })),
    { amount: Number(free.unsorted), word: "not sorted" },
    { amount: Number(free.saved), word: "saved" },
    { amount: Number(free.reserves.total), word: "reserved for plans" },
    { amount: shortfall(free), word: "past what reserves held" },
    { amount: Number(free.goals.total), word: "still to move to goals" },
  ];
  const less = parts
    .filter((part) => part.amount > 0)
    .map((part) => `${euros(part.amount)} ${part.word}`);
  const plus = parts
    .filter((part) => part.amount < 0)
    .map((part) => `${euros(-part.amount)} ${GAVE_BACK[part.word] ?? part.word}`);
  return [
    `${euros(free.income.total)} income`,
    less.length === 0 ? "" : `less ${less.join(", ")}`,
    plus.length === 0 ? "" : `plus ${plus.join(", ")}`,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Each line of free to spend as a table row, so the figure reads without the words above. */
function Sums({ free }: { free: Free }) {
  const parts = [{ key: "income" as const, word: "income" }, ...PARTS];
  return (
    <details className="finance-sums">
      <summary>How it adds up</summary>
      <table>
        <tbody>
          {parts.flatMap(({ key, word }) =>
            free[key].lines.map((line) => (
              <tr key={`${key}-${line.name}`}>
                <th scope="row">{line.name}</th>
                <td className="finance-muted">
                  {word}
                  {line.basis === "average" ? ", average" : ""}
                </td>
                <td>{euros(key === "income" ? line.counted : -Number(line.counted))}</td>
              </tr>
            )),
          )}
          {Number(free.unsorted) === 0 ? null : (
            <tr>
              <th scope="row">Not sorted yet</th>
              <td className="finance-muted">spending</td>
              <td>{euros(-Number(free.unsorted))}</td>
            </tr>
          )}
          {Number(free.saved) === 0 ? null : (
            <tr>
              <th scope="row">Moved to saving</th>
              <td className="finance-muted">saved</td>
              <td>{euros(-Number(free.saved))}</td>
            </tr>
          )}
          <ReserveRows free={free} />
        </tbody>
      </table>
    </details>
  );
}

/** What this month's bills cost past what their reserves held. */
function shortfall(free: Free): number {
  return free.reserves.lines.reduce((sum, line) => sum + Number(line.shortfall), 0);
}

/**
 * The reserves and the goals as rows of the table: each plan's share set aside, with what the
 * reserve holds after it, and each goal's contribution still to move this month.
 */
function ReserveRows({ free }: { free: Free }) {
  return (
    <>
      {free.reserves.lines.map((line) => (
        <tr key={`reserve-${line.plan_id}`}>
          <th scope="row">{line.name}</th>
          <td className="finance-muted">
            {`reserve, holds ${euros(line.balance)}${Number(line.paid) > 0 ? `, paid ${euros(line.paid)}` : ""}`}
          </td>
          <td>{euros(-Number(line.share))}</td>
        </tr>
      ))}
      {free.reserves.lines
        .filter((line) => Number(line.shortfall) > 0)
        .map((line) => (
          <tr key={`shortfall-${line.plan_id}`}>
            <th scope="row">{line.name}</th>
            <td className="finance-muted">{`bill past its reserve, paid ${euros(line.paid)}`}</td>
            <td>{euros(-Number(line.shortfall))}</td>
          </tr>
        ))}
      {free.goals.lines.map((line) => (
        <tr key={`goal-${line.goal_id}`}>
          <th scope="row">{line.name}</th>
          <td className="finance-muted">
            {line.done
              ? "goal, moved ✓"
              : `goal, ${euros(line.moved)} of ${euros(line.planned)} moved`}
          </td>
          <td>{euros(-(Number(line.planned) - Number(line.moved)))}</td>
        </tr>
      ))}
    </>
  );
}

function Hero({
  name,
  free,
  onOpen,
}: {
  name: string;
  free: Free | undefined;
  onOpen: () => void;
}) {
  const total = Number(free?.total ?? 0);
  return (
    <article className="overview-card finance-hero">
      <h3 className="overview-name">
        <button type="button" className="finance-crumb" onClick={onOpen}>
          {`${name} ›`}
        </button>
      </h3>
      <p className={total < 0 ? "finance-hero-figure finance-danger" : "finance-hero-figure"}>
        {free === undefined ? "…" : euros(total)}
      </p>
      <p className="overview-words">
        {free === undefined
          ? "loading"
          : total < 0
            ? `over by ${euros(-total)} ⚠`
            : "free to spend"}
      </p>
      {free === undefined ? null : <p className="finance-made-of">{madeOf(free)}</p>}
      {free === undefined ? null : <Sums free={free} />}
    </article>
  );
}

/** Flexible spending against the flexible limits, with a tick for how far the month has gone. */
function Pace({ budget }: { budget: Budget }) {
  const flexible = budget.categories.filter(
    (row) => row.kind === "flexible" && row.available != null,
  );
  // A limit an overspend cut below zero adds nothing, rather than taking from the others.
  const available = flexible.reduce((sum, row) => sum + Math.max(0, Number(row.available)), 0);
  // A refund larger than the month's spending is no negative pace.
  const spent = Math.max(
    0,
    flexible.reduce((sum, row) => sum + Number(row.spent), 0),
  );
  const share = Number(budget.share_of_month);
  const ahead = spent > available * share + available * 0.1;
  const status = spent > available ? "over" : ahead ? "near" : "ok";
  return (
    <article className="overview-card">
      <h3 className="overview-name">Pace</h3>
      <p className="overview-figure">{euros(spent)}</p>
      <p className="overview-words">
        {flexible.length === 0
          ? "no flexible limits set"
          : `of ${euros(available)} flexible, ${percent(share)} of ${monthName(budget.month, true)} gone`}
      </p>
      {flexible.length === 0 ? null : (
        <div className="overview-chart">
          <Meter spent={spent} available={available} status={status} tick={share} />
        </div>
      )}
      {flexible.length === 0 ? null : (
        <p className={`overview-caption finance-status-text-${status}`}>
          {status === "over"
            ? "over the flexible limits ⚠"
            : ahead
              ? "ahead of the month ⚠"
              : "on pace ✓"}
        </p>
      )}
    </article>
  );
}

/** The categories over or near their limit first, then those whose limit an overspend cut. */
function Watch({ budget }: { budget: Budget }) {
  const rank = { over: 0, near: 1 } as const;
  const flagged = budget.categories
    .filter((row) => row.status === "over" || row.status === "near")
    .sort((a, b) => rank[a.status as "over"] - rank[b.status as "over"]);
  const cut = budget.categories.filter((row) => Number(row.carried) > 0 && !flagged.includes(row));
  const before = monthName(shiftMonth(budget.month, -1), true);
  return (
    <article className="overview-card finance-watch">
      <h3 className="overview-name">Watch</h3>
      {flagged.length + cut.length === 0 ? (
        <p className="overview-words finance-status-text-ok">every category within its limit ✓</p>
      ) : (
        <ul className="finance-watch-list">
          {[...flagged, ...cut].map((row) => (
            <li key={row.id} className={`finance-status-${row.status ?? "none"}`}>
              <span className="finance-watch-name">{row.name}</span>
              <span className="finance-watch-sum">
                {euros(row.spent)} / {euros(row.available ?? 0)}
              </span>
              <span className={`finance-watch-state finance-status-text-${row.status ?? "none"}`}>
                {statusWords(row)}
              </span>
              {Number(row.carried) > 0 ? (
                <span className="finance-watch-cut">{`limit cut by ${euros(row.carried)} after ${before}`}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/**
 * What the limits left at each month end, less what went into goals, named "left from limits" so
 * it reads apart from a saving account's money not reserved for a goal; it can move into one.
 */
function LeftFromLimits({ budget, today }: { budget: Budget; today: string }) {
  const before = monthName(shiftMonth(budget.month, -1));
  const moved = Number(budget.unreserved.moved);
  return (
    <article className="overview-card">
      <h3 className="overview-name">Left from limits</h3>
      <p className="overview-figure">{euros(budget.unreserved.total)}</p>
      <p className="overview-words">{`${euros(budget.unreserved.last_month)} left over from ${before}`}</p>
      <p className="overview-caption">
        {`what the limits left at each month end since they began${moved > 0 ? `, less ${euros(moved)} moved into goals` : ""}`}
      </p>
      <MoveLeftover left={Number(budget.unreserved.total)} today={today} />
    </article>
  );
}

/**
 * The overview: free to spend for mine and household, big, with what each is made of; then
 * what to watch, the month's pace, the bank's last pull, where the month's money went, the
 * 12-month trend, what the limits left and the goals.
 */
export function FinanceOverview({
  month,
  today,
  onMonth,
  onCategory,
  onScope,
  pull,
}: {
  month: string;
  today: string;
  onMonth: (month: string) => void;
  /** Opens one category's drilldown for the month shown. */
  onCategory: (category: number) => void;
  /** Opens mine's or household's drilldown. */
  onScope: (scope: Scope) => void;
  pull: Pull;
}) {
  const free = useQuery({
    queryKey: ["finance", "free", month, today],
    queryFn: () => fetchFree(month, today),
  });
  const budget = useQuery({
    queryKey: ["finance", "budget", month, today],
    queryFn: () => fetchBudget(month, today),
  });
  const trend = useQuery({
    queryKey: ["finance", "trend", month],
    queryFn: () => fetchTrend(month),
  });
  const flow = useQuery({
    queryKey: ["finance", "flow", month],
    queryFn: () => fetchFlow(month),
  });
  const error = free.error ?? budget.error ?? trend.error ?? flow.error;
  return (
    <div className="finance-overview">
      {error ? <p role="alert">{error.message}</p> : null}
      <div className="finance-heroes">
        <Hero name="Mine" free={free.data?.mine} onOpen={() => onScope("mine")} />
        <Hero name="Household" free={free.data?.household} onOpen={() => onScope("household")} />
      </div>
      <div className="finance-cards">
        {budget.data === undefined ? null : <Watch budget={budget.data} />}
        {budget.data === undefined ? null : <Pace budget={budget.data} />}
        <BankCard pull={pull} />
        {flow.data === undefined ? null : (
          <article className="overview-card finance-wide-card finance-sankey-card">
            <h3 className="overview-name">Where it went</h3>
            <FinanceSankey flow={flow.data} month={month} today={today} onCategory={onCategory} />
          </article>
        )}
        {trend.data === undefined ? null : (
          <article className="overview-card finance-wide-card">
            <h3 className="overview-name">Spending</h3>
            <SpendingTrend trend={trend.data} month={month} onPick={onMonth} />
          </article>
        )}
        {budget.data === undefined ? null : <LeftFromLimits budget={budget.data} today={today} />}
        <GoalsCard today={today} />
      </div>
    </div>
  );
}
