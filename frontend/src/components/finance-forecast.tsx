import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BalanceLine } from "@/components/charts";
import { fetchForecast } from "@/lib/finance-plans-api";
import { euros, monthName } from "@/lib/finance-words";

type ScopeForecast = Awaited<ReturnType<typeof fetchForecast>>["mine"];

/**
 * One scope's balance at each month's end as a line, with the month pointed at read out above
 * it; a button over each month names it for a screen reader, as the spending trend's do.
 */
function ScopeLine({ name, forecast }: { name: string; forecast: ScopeForecast }) {
  const [hovered, setHovered] = useState<number>();
  const values = forecast.months.map((row) => Number(row.balance));
  const read = hovered ?? values.length - 1;
  const row = forecast.months[read];
  const below = values.filter((value) => value < 0).length;
  return (
    <figure className="finance-forecast-scope">
      <figcaption className="finance-forecast-name">{name}</figcaption>
      {row === undefined ? null : (
        <p className="finance-trend-readout" aria-live="polite">
          <span>{monthName(row.month)}</span>{" "}
          <strong className={Number(row.balance) < 0 ? "finance-danger" : undefined}>
            {euros(row.balance)}
            {Number(row.balance) < 0 ? " ⚠" : ""}
          </strong>
        </p>
      )}
      <div className="finance-trend-plot">
        <BalanceLine
          values={values}
          hovered={hovered}
          label={`${name}: balance by plans over ${values.length} months, from ${euros(forecast.balance)}${below ? `, below zero in ${below}` : ""}`}
        />
        <div className="finance-trend-hits">
          {forecast.months.map((month, index) => (
            <button
              key={month.month}
              type="button"
              aria-label={`${name}, end of ${monthName(month.month)}, ${euros(month.balance)}`}
              className="finance-trend-hit"
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(undefined)}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setHovered(index);
              }}
              onPointerLeave={() => setHovered(undefined)}
            />
          ))}
        </div>
      </div>
      <div className="finance-trend-axis" aria-hidden="true">
        {forecast.months.map((month) => (
          <span key={month.month}>
            <span className="finance-wide">{monthName(month.month, true)}</span>
            <span className="finance-narrow">{Number(month.month.slice(5))}</span>
          </span>
        ))}
      </div>
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
