import { useQuery } from "@tanstack/react-query";
import {
  AmountRows,
  categoryNames,
  DrillBookings,
  type DrillProps,
  Waiting,
} from "@/components/finance-drill-parts";
import { MonthChart } from "@/components/finance-month-chart";
import {
  fetchAccountDrill,
  fetchScope,
  type Scope,
  type ScopeDrill,
} from "@/lib/finance-drill-api";
import { euros, monthName } from "@/lib/finance-words";

type ScopeMonth = ScopeDrill["months"][number];

/** A scope's parts in the order the sankey stacks them, each with the sign it has on the month. */
function partsOf(scope: Scope): { key: keyof ScopeMonth; name: string; sign: 1 | -1 }[] {
  return [
    { key: "income", name: "Income", sign: 1 },
    scope === "household"
      ? { key: "other_scope", name: "From mine", sign: 1 }
      : { key: "other_scope", name: "Into household", sign: -1 },
    { key: "fixed", name: "Fixed", sign: -1 },
    { key: "flexible", name: "Flexible", sign: -1 },
    { key: "non_monthly", name: "Non-monthly", sign: -1 },
    { key: "reserved", name: "Reserved for plans", sign: -1 },
    { key: "saved", name: "Saved", sign: -1 },
    { key: "unsorted", name: "Not sorted", sign: -1 },
  ];
}

/** What a month spent: its fixed, flexible and non-monthly parts. */
function spentIn(row: ScopeMonth): number {
  return Number(row.fixed) + Number(row.flexible) + Number(row.non_monthly);
}

/**
 * One scope, mine or household: the month's parts as the sankey has them and what was left, the
 * months' spending as bars and every month as a table, its accounts and the month's bookings.
 */
export function DrillScope({
  scope,
  month,
  onOpen,
  onMonth,
  sorter,
  keys,
}: DrillProps & { scope: Scope }) {
  const drill = useQuery({
    queryKey: ["finance", "drill", "scope", scope, month],
    queryFn: () => fetchScope(scope, month),
  });
  const data = drill.data;
  const row = data?.months.at(-1);
  if (data === undefined || row === undefined) return <Waiting error={drill.error} />;
  const name = scope === "mine" ? "Mine" : "Household";
  const parts = partsOf(scope).filter(({ key }) => Number(row[key]) !== 0);
  const left = Number(row.left);
  return (
    <div className="finance-drill">
      <div className="finance-cards">
        <article className="overview-card">
          <h3 className="overview-name">{`${name} in ${monthName(month)}`}</h3>
          <p className={left < 0 ? "overview-figure finance-danger" : "overview-figure"}>
            {euros(left)}
          </p>
          <p className="overview-words">
            {left < 0 ? `spent ${euros(-left)} past what came in ⚠` : "left over"}
          </p>
          <table className="finance-drill-table">
            <tbody>
              {parts.map(({ key, name: part, sign }) => (
                <tr key={key}>
                  <th scope="row">{part}</th>
                  <td>{euros(sign * Number(row[key]))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="overview-caption">
            what happened, as the sankey draws it; free to spend on the overview also counts what is
            still to come
          </p>
        </article>
        <article className="overview-card finance-wide-card">
          <h3 className="overview-name">Spent per month</h3>
          <MonthChart
            months={data.months.map((m) => m.month)}
            values={data.months.map(spentIn)}
            month={month}
            onPick={onMonth}
            label={`${name}: fixed, flexible and non-monthly spending over ${data.months.length} months`}
            hitLabel={(index) => {
              const at = data.months[index];
              return at === undefined ? "" : `${monthName(at.month)}, ${euros(spentIn(at))} spent`;
            }}
            readout={(index) => {
              const at = data.months[index];
              if (at === undefined) return null;
              return (
                <>
                  <span>{monthName(at.month)}</span> <strong>{euros(spentIn(at))}</strong>
                  <span className="finance-muted">{` spent, ${euros(at.left)} left`}</span>
                </>
              );
            }}
          />
          <details className="finance-sums">
            <summary>Every month</summary>
            <table>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">In</th>
                  <th scope="col">Spent</th>
                  <th scope="col">Saved</th>
                  <th scope="col">Left</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((at) => (
                  <tr key={at.month}>
                    <th scope="row">{monthName(at.month, true)}</th>
                    <td>
                      {euros(
                        Number(at.income) + (scope === "household" ? Number(at.other_scope) : 0),
                      )}
                    </td>
                    <td>{euros(spentIn(at))}</td>
                    <td>{euros(at.saved)}</td>
                    <td className={Number(at.left) < 0 ? "finance-danger" : undefined}>
                      {euros(at.left)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </article>
        <article className="overview-card">
          <h3 className="overview-name">Accounts</h3>
          {data.accounts.length === 0 ? (
            <p className="overview-words">no account in this scope</p>
          ) : (
            <AmountRows
              label="Accounts"
              signed
              rows={data.accounts.map((account) => ({
                key: String(account.id),
                name:
                  account.balance_on == null
                    ? account.name
                    : `${account.name}, ${account.balance_on}`,
                amount: account.balance ?? 0,
                open: () => onOpen({ kind: "account", id: account.id, name: account.name }),
              }))}
            />
          )}
          <p className="overview-caption">the latest bank balance of each</p>
        </article>
      </div>
      <DrillBookings
        bookings={data.bookings}
        names={categoryNames(sorter)}
        onOpen={onOpen}
        keys={keys}
      />
    </div>
  );
}

/**
 * One account: its balance at each month end from the bank's balances and the bookings between,
 * the month's money by category and the transfers to and from the other own accounts, by booking
 * date, and the month's bookings.
 */
export function DrillAccount({
  id,
  month,
  onOpen,
  onMonth,
  sorter,
  keys,
}: DrillProps & { id: number }) {
  const drill = useQuery({
    queryKey: ["finance", "drill", "account", id, month],
    queryFn: () => fetchAccountDrill(id, month),
  });
  const data = drill.data;
  if (data === undefined) return <Waiting error={drill.error} />;
  const rows = data.months;
  return (
    <div className="finance-drill">
      <div className="finance-cards">
        <article className="overview-card finance-wide-card">
          <h3 className="overview-name">{`${data.account.name}: balance at each month end`}</h3>
          <MonthChart
            line
            months={rows.map((m) => m.month)}
            values={rows.map((m) => Number(m.balance))}
            month={month}
            onPick={onMonth}
            label={`${data.account.name}: balance at the end of each of ${rows.length} months`}
            hitLabel={(index) => {
              const at = rows[index];
              return at === undefined ? "" : `${monthName(at.month)}, ${euros(at.balance)}`;
            }}
            readout={(index) => {
              const at = rows[index];
              if (at === undefined) return null;
              return (
                <>
                  <span>{monthName(at.month)}</span>{" "}
                  <strong className={Number(at.balance) < 0 ? "finance-danger" : undefined}>
                    {euros(at.balance)}
                  </strong>
                  <span className="finance-muted">
                    {` in ${euros(at.money_in)}, out ${euros(at.money_out)}`}
                  </span>
                </>
              );
            }}
          />
          <p className="overview-caption">
            {rows.at(-1)?.balance_from == null
              ? "no bank balance yet: the bookings summed from zero"
              : `from the bank balance of ${rows.at(-1)?.balance_from} and the bookings between`}
          </p>
        </article>
        <article className="overview-card">
          <h3 className="overview-name">{`${monthName(month)} by category`}</h3>
          <AmountRows
            label="By category"
            signed
            rows={data.categories.map((row) => ({
              key: String(row.id),
              name: row.name,
              amount: row.amount,
              open:
                row.id == null
                  ? undefined
                  : () => onOpen({ kind: "category", id: row.id as number, name: row.name }),
            }))}
          />
          {data.transfers.length === 0 ? null : <h3 className="overview-name">Transfers</h3>}
          <AmountRows
            label="Transfers"
            signed
            rows={data.transfers.map((row) => ({
              key: String(row.id),
              name: row.name,
              amount: row.amount,
              open: () => onOpen({ kind: "account", id: row.id as number, name: row.name }),
            }))}
          />
          <p className="overview-caption">by booking date, as the bank balance counts them</p>
        </article>
      </div>
      <DrillBookings
        bookings={data.bookings}
        names={categoryNames(sorter)}
        onOpen={onOpen}
        keys={keys}
      />
    </div>
  );
}
