import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { usePull } from "@/components/finance-bank";
import { FinanceBudget } from "@/components/finance-budget-tab";
import { Breadcrumbs, FinanceDrill } from "@/components/finance-drill";
import { FinanceOverview } from "@/components/finance-overview";
import { FinancePlans } from "@/components/finance-plans-tab";
import type { TabKeys } from "@/components/finance-sort-bar";
import { SpanBar, useSpan } from "@/components/finance-span-bar";
import { FinanceToSort } from "@/components/finance-to-sort";
import { FinanceTransactions } from "@/components/finance-transactions";
import type { DrillStep } from "@/lib/finance-drill-api";
import { FINANCE_TABS, type FinanceTab } from "@/lib/finance-keys";
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

/** What tells two steps of a trail apart, so a new step at a place is drawn afresh. */
function stepKey(step: DrillStep): string {
  if (step.kind === "scope") return step.scope;
  return step.kind === "setup" ? step.kind : `${step.kind}-${step.id}`;
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
 * A key the pane leaves alone: Enter or Space on a focused button or summary is its own press,
 * and a chord such as Ctrl 1 belongs to the browser or the app, not to a category.
 */
function notOurs(event: KeyboardEvent): boolean {
  // A summary opens its details on Enter or Space, as a button presses.
  const pressable =
    event.target instanceof HTMLButtonElement ||
    (event.target instanceof HTMLElement && event.target.tagName === "SUMMARY");
  if (pressable && (event.key === "Enter" || event.key === " ")) return true;
  return event.ctrlKey || event.altKey || event.metaKey;
}

/**
 * The finance pane: Overview, To sort, Transactions, Budget and Plans & goals, under one month that `[` and `]`
 * step. The frame takes the keys every tab shares (the tabs, the month, "pull now", the leader,
 * `?` and `q`) after the tab in front has had its own.
 */
export function FinancePane({ commands, focusSignal, onNotice, today }: FinancePaneProps) {
  const [tab, setTab] = useState<FinanceTab>("overview");
  const spanState = useSpan(today);
  const { month, setMonth, span, label } = spanState;
  /** A bar's month, pressed: that month alone. */
  const pickMonth = (picked: string) => {
    spanState.setKind("month");
    setMonth(picked);
    panel.current?.focus();
  };
  // What the reader drilled down into from the tab, the month first; empty shows the tab itself.
  const [trail, setTrail] = useState<DrillStep[]>([]);
  const panel = useRef<HTMLElement>(null);
  const keys = useRef<TabKeys>(null);
  // Where a view drawn but hidden hands its keys, so they never reach the pane.
  const idle = useRef<TabKeys>(null);
  const id = useId();
  const leader = useLeader(commands);
  const sorter = useCategorySort(onNotice);
  const pull = usePull(onNotice);

  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  /** Show a tab and keep the keys in the pane, though what had the focus went with the old tab. */
  function show(name: FinanceTab) {
    setTab(name);
    setTrail([]);
    panel.current?.focus();
  }

  /** Go one step further down, keeping the keys in the pane as the old view goes. */
  function open(step: DrillStep) {
    setTrail((steps) => [...steps, step]);
    panel.current?.focus();
  }

  /** Go back to the trail's first `length` steps; none is the tab. */
  function back(length: number) {
    setTrail((steps) => steps.slice(0, length));
    panel.current?.focus();
  }

  // The overview and the drilldowns read a span; the other tabs read the month shown.
  const spans = trail.length > 0 || tab === "overview";
  const names = new Map((sorter.categories.data ?? []).map((c) => [c.id, c.name]));
  const openCategory = (id: number) =>
    open({ kind: "category", id, name: names.get(id) ?? "Category" });

  // On a phone the tab row scrolls sideways; bring the tab shown into view, keys or a tap alike.
  useEffect(() => {
    panel.current
      ?.querySelector(`[id="${id}-tab-${tab}"]`)
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [tab, id]);

  const frameKeys: Record<string, () => void> = {
    O: () => show("overview"),
    S: () => show("to-sort"),
    T: () => show("transactions"),
    B: () => show("budget"),
    G: () => show("plans"),
    "[": () => spanState.step(-1, spans),
    "]": () => spanState.step(1, spans),
    P: () => void pull.pull(),
    "?": () => commands.showHelp(),
    q: () => commands.closeNote(),
    // A drilldown steps back first; from the tab itself, back to the editor.
    Escape: () =>
      trail.length > 0
        ? back(trail.length - 1)
        : document.querySelector<HTMLElement>(".cm-content")?.focus(),
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

  // The tab in front. Drawn under a drilldown too, hidden, so it keeps what it held.
  const tabKeys = trail.length > 0 ? idle : keys;
  const views: Record<FinanceTab, () => ReactNode> = {
    overview: () => (
      <FinanceOverview
        month={month}
        span={span}
        spanLabel={label}
        today={today}
        onMonth={pickMonth}
        onCategory={openCategory}
        onScope={(scope) =>
          open({ kind: "scope", scope, name: scope === "mine" ? "Mine" : "Household" })
        }
        pull={pull}
      />
    ),
    "to-sort": () => <FinanceToSort sorter={sorter} keys={tabKeys} />,
    transactions: () => (
      <FinanceTransactions month={month} sorter={sorter} keys={tabKeys} onOpen={open} />
    ),
    budget: () => (
      <FinanceBudget
        month={month}
        today={today}
        keys={tabKeys}
        onNotice={onNotice}
        refocus={() => panel.current?.focus()}
        onSetup={() => open({ kind: "setup", name: "Every limit" })}
      />
    ),
    plans: () => (
      <FinancePlans
        month={month}
        today={today}
        keys={tabKeys}
        onNotice={onNotice}
        refocus={() => panel.current?.focus()}
      />
    ),
  };

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
              onClick={() => show(name)}
            >
              {label} <kbd>{key}</kbd>
            </button>
          ))}
        </div>
        {tab === "to-sort" && trail.length === 0 ? null : (
          <SpanBar state={spanState} spans={spans} today={today} />
        )}
      </header>
      <div
        id={`${id}-view`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tab}`}
        className="finance-pane-view"
      >
        {trail.length > 0 ? <Breadcrumbs label={label} trail={trail} onTrail={back} /> : null}
        {/* Every step stays drawn, hidden but the last, so stepping back finds its cursor and
            the tab its filters as they were. Only what is shown takes the keys. */}
        {trail.map((step, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a step is its place in the trail and what it opens.
            key={`${index}-${stepKey(step)}`}
            hidden={index !== trail.length - 1}
            className="finance-pane-stack"
          >
            <FinanceDrill
              step={step}
              month={month}
              span={span}
              spanLabel={label}
              today={today}
              onOpen={open}
              onMonth={pickMonth}
              sorter={sorter}
              keys={index === trail.length - 1 ? keys : idle}
              onNotice={onNotice}
            />
          </div>
        ))}
        <div hidden={trail.length > 0} className="finance-pane-stack">
          {views[tab]()}
        </div>
      </div>
    </section>
  );
}
