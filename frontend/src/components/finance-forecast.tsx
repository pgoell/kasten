import { useQuery } from "@tanstack/react-query";
import { MonthChart } from "@/components/finance-month-chart";
import { fetchForecast } from "@/lib/finance-plans-api";
import { euros, monthName } from "@/lib/finance-words";

type ScopeForecast = Awaited<ReturnType<typeof fetchForecast>>["mine"];

/**
 * One scope's balance at each month's end as a line, with the month pointed at read out above
 * it; a button over each month names it for a screen reader, as the spending trend's do.
 */
function ScopeLine({ name, forecast }: { name: string; forecast: ScopeForecast }) {
  const values = forecast.months.map((row) => Number(row.balance));
  const below = values.filter((value) => value < 0).length;
  return (
    <figure className="finance-forecast-scope">
      <figcaption className="finance-forecast-name">{name}</figcaption>
      <MonthChart
        line
        months={forecast.months.map((row) => row.month)}
        values={values}
        label={`${name}: balance by plans over ${values.length} months, from ${euros(forecast.balance)}${below ? `, below zero in ${below}` : ""}`}
        hitLabel={(index) => {
          const row = forecast.months[index];
          return `${name}, end of ${monthName(row?.month ?? "")}, ${euros(row?.balance ?? 0)}`;
        }}
        readout={(read) => {
          const row = forecast.months[read];
          if (row === undefined) return null;
          return (
            <>
              <span>{monthName(row.month)}</span>{" "}
              <strong className={Number(row.balance) < 0 ? "finance-danger" : undefined}>
                {euros(row.balance)}
                {Number(row.balance) < 0 ? " ⚠" : ""}
              </strong>
            </>
          );
        }}
      />
    </figure>
  );
}

/**
 * The forecast by plans: mine's and household's balance at each month's end, from today's bank
 * balances and the plans alone, as a line each, and every month as a table folded under them.
 */
export function Forecast({ today }: { today: string }) {
  const forecast = useQuery({
    queryKey: ["finance", "forecast", today],
    queryFn: () => fetchForecast(today),
  });
  if (forecast.data === undefined) return null;
  const { mine, household } = forecast.data;
  return (
    <section aria-label="Forecast" className="finance-plans-group finance-plans-wide">
      <h3>Forecast by plans</h3>
      <p className="finance-muted">
        each month's end, from today's bank balance and the plans alone; flexible spending is not in
        it
      </p>
      <div className="finance-forecast-lines">
        <ScopeLine name="Mine" forecast={mine} />
        <ScopeLine name="Household" forecast={household} />
      </div>
      <details className="finance-sums">
        <summary>Every month</summary>
        <table className="finance-forecast">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Mine</th>
              <th scope="col">Household</th>
            </tr>
          </thead>
          <tbody>
            {mine.months.map((row, index) => (
              <tr key={row.month}>
                <th scope="row">{monthName(row.month, true)}</th>
                <td className={Number(row.balance) < 0 ? "finance-danger" : undefined}>
                  {euros(row.balance)}
                </td>
                <td
                  className={
                    Number(household.months[index]?.balance ?? 0) < 0 ? "finance-danger" : undefined
                  }
                >
                  {euros(household.months[index]?.balance ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
