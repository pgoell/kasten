import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { usePull } from "@/components/finance-bank";
import { FinanceBudget } from "@/components/finance-budget-tab";
import { FinanceOverview } from "@/components/finance-overview";
import type { TabKeys } from "@/components/finance-sort-bar";
import { FinanceToSort } from "@/components/finance-to-sort";
import { FinanceTransactions } from "@/components/finance-transactions";
import { FINANCE_TABS, type FinanceTab } from "@/lib/finance-keys";
import { monthName, monthOf, shiftMonth } from "@/lib/finance-words";
import type { EditorCommands } from "@/lib/key-bindings";
import { useCategorySort } from "@/lib/use-category-sort";
import { useLeader } from "@/lib/use-leader";

export interface FinancePaneProps {
  /** Reached by a leader sequence typed here, so every leader key still works. */
  commands: EditorCommands;
  /** Raised by the route when this pane has been moved to. See `Editor`. */
  focusSignal: number;
  /** Says why a write was refused, or clears the line with undefined. */
  onNotice: (text: string | undefined) => void;
  /** Today, as `YYYY-MM-DD`. The route reads the clock; this stays pure of it. */
  today: string;
}

/** A key typed into a field is the field's, Escape aside, which leaves it. */
function inField(target: EventTarget): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

/**
 * A key the pane leaves alone: Enter or Space on a focused button is that button's own press,
 * and a chord such as Ctrl 1 belongs to the browser or the app, not to a category.
 */
function notOurs(event: KeyboardEvent): boolean {
  const button = event.target instanceof HTMLButtonElement;
  if (button && (event.key === "Enter" || event.key === " ")) return true;
  return event.ctrlKey || event.altKey || event.metaKey;
}

/**
 * The finance pane: Overview, To sort, Transactions and Budget, under one month that `[` and `]`
 * step. The frame takes the keys every tab shares (the tabs, the month, "pull now", the leader,
 * `?` and `q`) after the tab in front has had its own.
 */
export function FinancePane({ commands, focusSignal, onNotice, today }: FinancePaneProps) {
  const [tab, setTab] = useState<FinanceTab>("overview");
  const [month, setMonth] = useState(monthOf(today));
  const panel = useRef<HTMLElement>(null);
  const keys = useRef<TabKeys>(null);
  const id = useId();
  const leader = useLeader(commands);
  const sorter = useCategorySort(onNotice);
  const pull = usePull(onNotice);

  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  const frameKeys: Record<string, () => void> = {
    O: () => setTab("overview"),
    S: () => setTab("to-sort"),
    T: () => setTab("transactions"),
    B: () => setTab("budget"),
    "[": () => setMonth(shiftMonth(month, -1)),
    "]": () => setMonth(shiftMonth(month, 1)),
    P: () => void pull.pull(),
    "?": () => commands.showHelp(),
    q: () => commands.closeNote(),
    Escape: () => document.querySelector<HTMLElement>(".cm-content")?.focus(),
  };

  function onKeyDown(event: KeyboardEvent) {
    if (inField(event.target)) {
      if (event.key === "Escape") panel.current?.focus();
      return;
    }
    if (notOurs(event) || leader.feed(event)) return;
    if (event.key === " ") {
      leader.start(event);
      return;
    }
    const run = keys.current?.(event.key) ? () => undefined : frameKeys[event.key];
    if (run === undefined) return;
    run();
    event.preventDefault();
  }

  // Each tab hands its keys over as it draws; one that is not drawn has none.
  keys.current = null;
  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label="Finance"
      onKeyDown={onKeyDown}
      className="finance-pane"
    >
      <header className="finance-pane-head">
        <div role="tablist" aria-label="Finance view" className="finance-pane-tabs">
          {FINANCE_TABS.map(({ tab: name, label, key }) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`${id}-tab-${name}`}
              aria-controls={`${id}-view`}
              aria-selected={tab === name}
              className="finance-pane-tab"
              onClick={() => setTab(name)}
            >
              {label} <kbd>{key}</kbd>
            </button>
          ))}
        </div>
        {tab === "to-sort" ? null : (
          <div className="finance-pane-month">
            <button
              type="button"
              className="finance-pane-button"
              aria-label="Month before"
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              ‹
            </button>
            <h2>{monthName(month)}</h2>
            <button
              type="button"
              className="finance-pane-button"
              aria-label="Month after"
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              ›
            </button>
            {month === monthOf(today) ? null : (
              <button
                type="button"
                className="finance-pane-button"
                onClick={() => setMonth(monthOf(today))}
              >
                This month
              </button>
            )}
          </div>
        )}
      </header>
      <div
        id={`${id}-view`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tab}`}
        className="finance-pane-view"
      >
        {tab === "overview" ? (
          <FinanceOverview month={month} today={today} onMonth={setMonth} pull={pull} />
        ) : null}
        {tab === "to-sort" ? <FinanceToSort sorter={sorter} keys={keys} /> : null}
        {tab === "transactions" ? (
          <FinanceTransactions month={month} sorter={sorter} keys={keys} />
        ) : null}
        {tab === "budget" ? (
          <FinanceBudget month={month} today={today} keys={keys} onNotice={onNotice} />
        ) : null}
      </div>
    </section>
  );
}
