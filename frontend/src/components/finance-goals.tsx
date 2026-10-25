import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { amountOf, positive } from "@/components/finance-budget-tab";
import { Meter } from "@/components/finance-meter";
import { fetchGoals, type Goal, type GoalIn, type Goals } from "@/lib/finance-plans-api";
import { euros, monthName, monthOf } from "@/lib/finance-words";

/** This month's contribution in words, with a sign beside the colour: `500 € moved ✓`. */
export function contributionWords(goal: Goal): string {
  const month = goal.this_month;
  if (month == null)
    return Number(goal.monthly ?? 0) > 0 ? "no contribution due" : "no contribution set";
  if (month.done) return `${euros(month.moved)} moved this month ✓`;
  return `${euros(month.moved)} of ${euros(month.planned)} moved this month`;
}

/**
 * One goal: what is reserved against the target as a meter, the date, what each month needs to
 * reach it, and whether this month's contribution reached the account.
 */
export function GoalBar({ goal, account }: { goal: Goal; account: string | undefined }) {
  const reserved = Number(goal.reserved);
  const target = Number(goal.target);
  return (
    <div className="finance-goal">
      <p className="finance-goal-head">
        <span className="finance-goal-name">{goal.name}</span>
        <span className="finance-goal-sum">
          {euros(reserved)} <span className="finance-muted">/ {euros(target)}</span>
        </span>
      </p>
      <Meter spent={reserved} available={target} status={null} />
      <p className="finance-goal-aside">
        <span>{`${account === undefined ? "" : `${account}, `}by ${monthName(monthOf(goal.due), true)} ${goal.due.slice(0, 4)}, ${reserved >= target ? "reached ✓" : `needs ${euros(goal.need)} a month`}`}</span>
        <span
          className={goal.this_month?.done ? "finance-status-text-ok" : "finance-status-text-none"}
        >
          {contributionWords(goal)}
        </span>
      </p>
    </div>
  );
}

/**
 * Each saving account's balance less what its goals reserve, named "not reserved on" so it reads
 * apart from what the limits left; a ⚠ when the balance fell below what the goals reserve.
 */
export function NotReserved({ goals }: { goals: Goals }) {
  return (
    <ul className="finance-goal-accounts">
      {goals.accounts.map((account) => (
        <li key={account.id}>
          <span>{`Not reserved on ${account.name}`}</span>
          <span
            className={
              Number(account.unreserved) < 0 ? "finance-status-text-over" : "finance-muted"
            }
          >
            {Number(account.unreserved) < 0
              ? `goals reserve ${euros(-Number(account.unreserved))} more than its ${euros(account.balance)} ⚠`
              : `${euros(account.unreserved)} of ${euros(account.balance)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The overview's card: every goal's bar, then what each saving account has unreserved. */
export function GoalsCard({ today }: { today: string }) {
  const goals = useQuery({
    queryKey: ["finance", "goals", today],
    queryFn: () => fetchGoals(today),
  });
  if (goals.data === undefined) return null;
  const names = new Map(goals.data.accounts.map((account) => [account.id, account.name]));
  return (
    <article className="overview-card finance-full-card finance-goals-card">
      <h3 className="overview-name">Goals</h3>
      {goals.data.goals.length === 0 ? (
        <p className="overview-words">no goals yet: add one on Plans & goals</p>
      ) : (
        <div className="finance-goals-grid">
          {goals.data.goals.map((goal) => (
            <GoalBar key={goal.id} goal={goal} account={names.get(goal.account_id)} />
          ))}
        </div>
      )}
      <NotReserved goals={goals.data} />
    </article>
  );
}

interface GoalFormProps {
  goal: Goal | undefined;
  today: string;
  goals: Goals;
  onSave: (goal: GoalIn) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

/** A goal's fields: name, target, due date, the saving account, what is reserved, the monthly. */
export function GoalForm({ goal, today, goals, onSave, onCancel, onDelete }: GoalFormProps) {
  const [draft, setDraft] = useState({
    name: goal?.name ?? "",
    target: goal === undefined ? "" : String(Number(goal.target)),
    due: goal?.due ?? today,
    account: String(goal?.account_id ?? goals.accounts[0]?.id ?? ""),
    reserved: goal === undefined ? "0" : String(Number(goal.reserved)),
    monthly: goal?.monthly == null ? "" : String(Number(goal.monthly)),
  });
  const set = (field: keyof typeof draft) => (value: string) =>
    setDraft({ ...draft, [field]: value });
  const fixed = (text: string) => (Number(amountOf(text) ?? "0") || 0).toFixed(2);
  // Reserved and monthly may be nothing, but not something that is no number.
  const number = (text: string) => text.trim() === "" || Number.isFinite(Number(amountOf(text)));
  const valid =
    draft.name.trim() !== "" &&
    positive(draft.target) !== undefined &&
    number(draft.reserved) &&
    number(draft.monthly);

  return (
    <form
      className="finance-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSave({
          name: draft.name.trim(),
          target: fixed(draft.target),
          due: draft.due,
          account_id: Number(draft.account),
          reserved: fixed(draft.reserved),
          monthly: draft.monthly.trim() === "" ? null : fixed(draft.monthly),
        });
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <label>
        Name
        {/* biome-ignore lint/a11y/noAutofocus: the form opens on a key or a tap meant to type into it. */}
        <input autoFocus value={draft.name} onChange={(e) => set("name")(e.target.value)} />
      </label>
      <label>
        Target €
        <input
          inputMode="decimal"
          value={draft.target}
          onChange={(e) => set("target")(e.target.value)}
        />
      </label>
      <label>
        Due
        <input type="date" value={draft.due} onChange={(e) => set("due")(e.target.value)} />
      </label>
      <label>
        Saving account
        <select value={draft.account} onChange={(e) => set("account")(e.target.value)}>
          {goals.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {`${account.name}, ${euros(account.unreserved)} not reserved`}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reserved €
        <input
          inputMode="decimal"
          value={draft.reserved}
          onChange={(e) => set("reserved")(e.target.value)}
        />
      </label>
      <label>
        Monthly €
        <input
          inputMode="decimal"
          value={draft.monthly}
          placeholder={goal === undefined ? "" : `needs ${euros(goal.need)}`}
          onChange={(e) => set("monthly")(e.target.value)}
        />
      </label>
      <div className="finance-form-actions">
        <button type="submit" className="finance-pane-button finance-small" disabled={!valid}>
          Save
        </button>
        <button type="button" className="finance-pane-button finance-small" onClick={onCancel}>
          Cancel
        </button>
        {onDelete === undefined ? null : (
          <button type="button" className="finance-pane-button finance-small" onClick={onDelete}>
            Delete
          </button>
        )}
        {valid ? null : <span className="finance-muted">a name and a target above 0</span>}
      </div>
    </form>
  );
}
