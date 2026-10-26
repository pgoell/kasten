import { useQuery } from "@tanstack/react-query";
import { type RefObject, useState } from "react";
import type { TabKeys } from "@/components/finance-sort-bar";
import type { DrillStep } from "@/lib/finance-drill-api";
import {
  fetchTaxYear,
  lineCsvUrl,
  lineLabel,
  receiptsZipUrl,
  type TaxEntry,
} from "@/lib/finance-tax-api";
import { money } from "@/lib/finance-words";

/** A marked booking as one line of a list, which opens the booking. */
function EntryButton({
  entry,
  onOpen,
}: {
  entry: Pick<TaxEntry, "transaction_id" | "booking_date" | "payee" | "amount"> & {
    form_line?: string;
  };
  onOpen: (step: DrillStep) => void;
}) {
  const line = entry.form_line === undefined ? "" : `, ${lineLabel(entry.form_line)}`;
  return (
    <li>
      <button
        type="button"
        className="finance-crumb"
        onClick={() => onOpen({ kind: "booking", id: entry.transaction_id, name: entry.payee })}
      >
        {`${entry.booking_date}, ${entry.payee}, ${money(entry.amount)}${line} ›`}
      </button>
    </li>
  );
}

/**
 * The tax year: what counts on each line of the return for the bookings paid in it, the
 * Werbungskosten over the allowance, the receipts still missing, money back that may belong
 * to a marked cost, and the exports. `[` and `]` step the year.
 */
export function FinanceTax({
  today,
  keys,
  onOpen,
}: {
  today: string;
  keys: RefObject<TabKeys | null>;
  onOpen: (step: DrillStep) => void;
}) {
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const summary = useQuery({
    queryKey: ["finance", "tax", "year", year],
    queryFn: () => fetchTaxYear(year),
  });
  keys.current = (key) => {
    if (key !== "[" && key !== "]") return false;
    setYear((shown) => shown + (key === "]" ? 1 : -1));
    return true;
  };
  const data = summary.data;
  const werbungskosten = data?.lines.find((line) => line.form_line === "werbungskosten");

  return (
    <div className="finance-tax">
      <div className="finance-tax-year">
        <button
          type="button"
          className="finance-pane-button"
          aria-label="The year before"
          onClick={() => setYear(year - 1)}
        >
          ‹
        </button>
        <h3 className="overview-name">{`Tax year ${year}`}</h3>
        <button
          type="button"
          className="finance-pane-button"
          aria-label="The year after"
          onClick={() => setYear(year + 1)}
        >
          ›
        </button>
      </div>
      {summary.error ? <p role="alert">{summary.error.message}</p> : null}
      {data === undefined ? null : (
        <div className="finance-cards">
          <article className="overview-card finance-wide-card">
            <h3 className="overview-name">Per line, by the day paid</h3>
            <table className="finance-drill-table">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Counts</th>
                  <th scope="col">Missing</th>
                  <th scope="col">CSV</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={line.form_line}>
                    <th scope="row">{`${line.label} (${line.bookings})`}</th>
                    <td>{money(line.total)}</td>
                    <td>{line.missing}</td>
                    <td>
                      <a href={lineCsvUrl(year, line.form_line)} download>
                        CSV
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="overview-caption">
              {`Werbungskosten ${money(werbungskosten?.total ?? "0")}: ${money(data.werbungskosten_over)} over the allowance of ${money(data.allowance)}`}
            </p>
            <a className="finance-pane-button" href={receiptsZipUrl(year)} download>
              Every receipt of the year (ZIP)
            </a>
          </article>
          <article className="overview-card">
            <h3 className="overview-name">{`Receipts missing (${data.missing.length})`}</h3>
            {data.missing.length === 0 ? (
              <p className="overview-caption">every marked booking has its receipt</p>
            ) : (
              <ul className="finance-drill-notes">
                {data.missing.map((entry) => (
                  <EntryButton key={entry.transaction_id} entry={entry} onOpen={onOpen} />
                ))}
              </ul>
            )}
          </article>
          {data.money_back.length === 0 ? null : (
            <article className="overview-card">
              <h3 className="overview-name">Money back to check</h3>
              <p className="overview-caption">
                money in that may pay a marked cost back: mark it on the same line to take it off
              </p>
              <ul className="finance-drill-notes">
                {data.money_back.map((entry) => (
                  <EntryButton key={entry.transaction_id} entry={entry} onOpen={onOpen} />
                ))}
              </ul>
            </article>
          )}
          <article className="overview-card finance-wide-card">
            <h3 className="overview-name">{`Marked bookings (${data.entries.length})`}</h3>
            <ul className="finance-drill-notes">
              {data.entries.map((entry) => (
                <EntryButton key={entry.transaction_id} entry={entry} onOpen={onOpen} />
              ))}
            </ul>
          </article>
        </div>
      )}
    </div>
  );
}
