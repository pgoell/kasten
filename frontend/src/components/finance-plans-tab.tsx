import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useState } from "react";
import { Forecast } from "@/components/finance-forecast";
import { GoalBar, GoalForm, NotReserved } from "@/components/finance-goals";
import { MoveLeftover } from "@/components/finance-leftover";
import { PlanForm, scheduleName } from "@/components/finance-plan-form";
import type { TabKeys } from "@/components/finance-sort-bar";
import { type Category, fetchCategories } from "@/lib/finance-api";
import { type Account, fetchAccounts, fetchBudget } from "@/lib/finance-budget-api";
import {
  adding,
  assignGoal,
  type Due,
  deleteGoal,
  deletePlan,
  fetchGoals,
  fetchPlans,
  fetchProposals,
  fetchUpcoming,
  type Goal,
  type Goals,
  type Plan,
  type PlanIn,
  type Proposal,
  planOf,
  undoAssign,
  writeGoal,
  writePlan,
} from "@/lib/finance-plans-api";
import { euros, money, monthName, monthOf } from "@/lib/finance-words";

/** The keys proposals take, one each in the order they are listed. */
const PROPOSAL_KEYS = "123456789";

/**
 * The form open: a plan or a goal, made new or edited by `id`. `draft` fills a new plan's form,
 * for a proposal with nothing to match by that has to be finished by hand.
 */
type Editing = { kind: "plan" | "goal"; id?: number; draft?: PlanIn } | undefined;

/** A date as `30 Sep`, counted in UTC so no zone moves it. */
function day(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function Proposals({
  proposals,
  busy,
  onConfirm,
}: {
  proposals: Proposal[];
  busy: boolean;
  onConfirm: (p: Proposal) => void;
}) {
  if (proposals.length === 0) return null;
  return (
    <section aria-label="Proposed plans" className="finance-plans-group">
      <h3>Proposed from history</h3>
      <ul className="finance-plans-list">
        {proposals.map((proposal, index) => (
          <li key={proposal.key} className="finance-plans-row">
            <span className="finance-plans-name">{proposal.name}</span>
            <span className="finance-plans-sum">{money(proposal.amount)}</span>
            <span className="finance-muted finance-plans-aside">
              {`${scheduleName(proposal.every_months)}, ${proposal.source === "bill" ? "a Firefly bill" : "a recurring payee"}, ${proposal.seen === 1 ? "seen once" : `seen ${proposal.seen} times`}, last ${day(proposal.last)}`}
            </span>
            <button
              type="button"
              className="finance-pane-button finance-small"
              aria-label={`Confirm ${proposal.name}`}
              disabled={busy}
              onClick={() => onConfirm(proposal)}
            >
              {index < PROPOSAL_KEYS.length ? <kbd>{PROPOSAL_KEYS[index]}</kbd> : null} Confirm
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the month's date shows beside it: the booking that met it, or when it is due. */
function dueWords(due: Due): string {
  const from = due.reserves ? ", from its reserve" : "";
  const counts = due.counts_for == null ? "" : `, counts for ${monthName(due.counts_for)}`;
  if (due.match == null) return `due ${day(due.due)}${counts}${from}`;
  const timing = due.match.timing === "on_time" ? "" : `, ${due.match.timing}`;
  return `met ${day(due.match.booking_date)}${timing}, ${money(due.match.amount)}${counts}${from}`;
}

function Upcoming({ dues, month }: { dues: Due[]; month: string }) {
  return (
    <section aria-label="This month" className="finance-plans-group">
      <h3>{`Due in ${monthName(month)}`}</h3>
      {dues.length === 0 ? <p className="finance-muted">nothing planned this month</p> : null}
      <ul className="finance-plans-list">
        {dues.map((due) => (
          <li key={`${due.plan_id}-${due.due}`} className="finance-plans-row">
            <span
              className={
                due.match == null
                  ? "finance-plans-tick finance-muted"
                  : "finance-plans-tick finance-status-text-ok"
              }
              role="img"
              aria-label={due.match == null ? "upcoming" : "met"}
            >
              {due.match == null ? "○" : "✓"}
            </span>
            <span className="finance-plans-name">{due.name}</span>
            <span className="finance-plans-sum">{money(due.amount)}</span>
            <span className="finance-muted finance-plans-aside">{dueWords(due)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Plans({
  plans,
  onEdit,
  onNew,
}: {
  plans: Plan[];
  onEdit: (p: Plan) => void;
  onNew: () => void;
}) {
  return (
    <section aria-label="Plans" className="finance-plans-group">
      <h3>Plans</h3>
      <ul className="finance-plans-list">
        {plans.map((plan) => (
          <li key={plan.id} className="finance-plans-row">
            <span className="finance-plans-name">{plan.name}</span>
            <span className="finance-plans-sum">{money(plan.amount)}</span>
            <span className="finance-muted finance-plans-aside">
              {`${scheduleName(plan.every_months)}${plan.reserves ? `, reserves ${money(plan.share)} a month when set aside in time` : ""}`}
            </span>
            <button
              type="button"
              className="finance-pane-button finance-small"
              aria-label={`Edit ${plan.name}`}
              onClick={() => onEdit(plan)}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="finance-pane-button finance-small" onClick={onNew}>
        <kbd>n</kbd> New plan
      </button>
    </section>
  );
}

interface GoalsProps {
  goals: Goals;
  at: number;
  today: string;
  left: number | undefined;
  busy: boolean;
  onSelect: (index: number) => void;
  onAssign: (goal: Goal) => void;
  onUndo: (goal: Goal) => void;
  onEdit: (goal: Goal) => void;
  onNew: () => void;
}

/** Whether this month's contribution was assigned to the goal already. */
function assigned(goal: Goal, today: string): boolean {
  return goal.assigned_month === monthOf(today);
}

/** Whether a goal can take its contribution now: not yet this month, and its account holds it. */
export function canAssign(goal: Goal, goals: Goals, today: string): boolean {
  const account = goals.accounts.find((found) => found.id === goal.account_id);
  const amount = adding(goal);
  return !assigned(goal, today) && amount > 0 && amount <= Number(account?.unreserved ?? 0);
}

/** Why a goal cannot take its contribution now, in words beside the greyed button. */
function whyNot(goal: Goal, goals: Goals): string {
  if (Number(goal.reserved) >= Number(goal.target)) return "target reached";
  if (adding(goal) <= 0) return "no monthly contribution set";
  const account = goals.accounts.find((found) => found.id === goal.account_id);
  return `only ${euros(Math.max(0, Number(account?.unreserved ?? 0)))} not reserved on ${account?.name ?? "its account"}`;
}

/** Assign, or once assigned this month the amount with a tick and an undo. */
function AssignButton({
  goal,
  goals,
  today,
  cursor,
  busy,
  onAssign,
  onUndo,
}: {
  goal: Goal;
  goals: Goals;
  today: string;
  cursor: boolean;
  busy: boolean;
  onAssign: (goal: Goal) => void;
  onUndo: (goal: Goal) => void;
}) {
  if (assigned(goal, today)) {
    return (
      <>
        <span className="finance-status-text-ok finance-goal-assigned">
          {`${euros(goal.assigned_amount ?? 0)} assigned ✓`}
        </span>
        <button
          type="button"
          className="finance-pane-button finance-small"
          aria-label={`Undo assigning to ${goal.name}`}
          disabled={busy}
          onClick={() => onUndo(goal)}
        >
          {cursor ? <kbd>u</kbd> : null} Undo
        </button>
      </>
    );
  }
  const able = canAssign(goal, goals, today);
  return (
    <>
      <button
        type="button"
        className="finance-pane-button finance-small"
        disabled={!able || busy}
        aria-label={`Assign ${euros(adding(goal))} to ${goal.name}`}
        onClick={() => onAssign(goal)}
      >
        {cursor ? <kbd>a</kbd> : null} Assign {euros(adding(goal))}
      </button>
      {able ? null : <span className="finance-muted finance-goal-why">{whyNot(goal, goals)}</span>}
    </>
  );
}

function GoalList(props: GoalsProps) {
  const { goals, at, today, left, onSelect, onEdit, onNew } = props;
  const names = new Map(goals.accounts.map((account) => [account.id, account.name]));
  return (
    <section aria-label="Goals" className="finance-plans-group">
      <h3>Goals</h3>
      <ul className="finance-plans-list">
        {goals.goals.map((goal, index) => (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the cursor row is the one marked, as the budget's is.
          <li
            key={goal.id}
            aria-selected={index === at}
            className={index === at ? "finance-goal-row finance-pane-selected" : "finance-goal-row"}
          >
            <button type="button" className="finance-goal-pick" onClick={() => onSelect(index)}>
              <GoalBar goal={goal} account={names.get(goal.account_id)} />
            </button>
            <div className="finance-budget-actions">
              <AssignButton
                goal={goal}
                goals={goals}
                today={today}
                cursor={index === at}
                busy={props.busy}
                onAssign={props.onAssign}
                onUndo={props.onUndo}
              />
              <button
                type="button"
                className="finance-pane-button finance-small"
                aria-label={`Edit ${goal.name}`}
                onClick={() => onEdit(goal)}
              >
                {index === at ? <kbd>e</kbd> : null} Edit
              </button>
            </div>
          </li>
        ))}
      </ul>
      <NotReserved goals={goals} />
      {left === undefined ? null : (
        <div className="finance-goal-leftover">
          <span>{`Left from limits: ${money(left)}`}</span>
          <MoveLeftover left={left} today={today} />
        </div>
      )}
      <button type="button" className="finance-pane-button finance-small" onClick={onNew}>
        <kbd>g</kbd> New goal
      </button>
    </section>
  );
}

/** `a` assigns the goal's contribution while it can take one; `u` undoes this month's. */
function assignKeys(
  goal: Goal | undefined,
  goals: Goals | undefined,
  today: string,
  run: (write: () => Promise<void>) => Promise<void>,
): Record<string, (() => void) | undefined> {
  if (goal === undefined || goals === undefined) return {};
  return {
    a: canAssign(goal, goals, today) ? () => void run(() => assignGoal(goal.id, today)) : undefined,
    u: assigned(goal, today) ? () => void run(() => undoAssign(goal.id, today)) : undefined,
  };
}

interface FormsProps {
  editing: Editing;
  plans: Plan[];
  goals: Goals | undefined;
  accounts: Account[];
  categories: Category[];
  today: string;
  run: (write: () => Promise<void>) => Promise<void>;
  onCancel: () => void;
}

/** The plan or goal form open, if one is: made new, or editing the one `editing` names. */
function Forms({ editing, plans, goals, accounts, categories, today, run, onCancel }: FormsProps) {
  const editedPlan = plans.find((plan) => editing?.kind === "plan" && plan.id === editing.id);
  const editedGoal = goals?.goals.find(
    (goal) => editing?.kind === "goal" && goal.id === editing.id,
  );
  return (
    <>
      {editing?.kind === "plan" ? (
        <PlanForm
          key={editing.id ?? "new"}
          plan={editedPlan ?? editing.draft}
          today={today}
          accounts={accounts}
          categories={categories}
          onSave={(body) => void run(() => writePlan(body, today, editing.id))}
          onCancel={onCancel}
          onDelete={
            editing.id === undefined ? undefined : () => void run(() => deletePlan(editing.id ?? 0))
          }
        />
      ) : null}
      {editing?.kind === "goal" && goals !== undefined ? (
        <GoalForm
          key={editing.id ?? "new"}
          goal={editedGoal}
          today={today}
          goals={goals}
          onSave={(body) => void run(() => writeGoal(body, editing.id))}
          onCancel={onCancel}
          onDelete={
            editing.id === undefined ? undefined : () => void run(() => deleteGoal(editing.id ?? 0))
          }
        />
      ) : null}
    </>
  );
}

interface TabProps {
  month: string;
  today: string;
  keys: RefObject<TabKeys | null>;
  onNotice: (text: string | undefined) => void;
  /** Gives the pane the keys back once a form closes. */
  refocus: () => void;
}

/**
 * Plans and goals: the plans proposed from history, a key each to confirm; the month's dates with
 * a tick once a booking met them; every plan to edit; the goals with what each has reserved and
 * needs, assigned once a month or changed with one key, and the limits' leftover to move into
 * one; and the forecast by plans. Two columns on a wide pane, one on a phone.
 */
export function FinancePlans({ month, today, keys, onNotice, refocus }: TabProps) {
  const queries = useQueryClient();
  const plans = useQuery({ queryKey: ["finance", "plans"], queryFn: fetchPlans });
  const dues = useQuery({
    queryKey: ["finance", "upcoming", month],
    queryFn: () => fetchUpcoming(month),
  });
  const proposals = useQuery({
    queryKey: ["finance", "proposals", today],
    queryFn: () => fetchProposals(today),
  });
  const goals = useQuery({
    queryKey: ["finance", "goals", today],
    queryFn: () => fetchGoals(today),
  });
  const accounts = useQuery({ queryKey: ["finance", "accounts"], queryFn: fetchAccounts });
  const budget = useQuery({
    queryKey: ["finance", "budget", month, today],
    queryFn: () => fetchBudget(month, today),
  });
  const categories = useQuery({ queryKey: ["finance", "categories"], queryFn: fetchCategories });
  const [editing, setEditing] = useState<Editing>();
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const goalRows = goals.data?.goals ?? [];
  const at = Math.max(0, Math.min(cursor, goalRows.length - 1));

  /**
   * Run a write, one at a time, so a second press while the first is out makes no twin; a
   * refused one says why and leaves the form open.
   */
  async function run(write: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await write();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      onNotice(error.message);
      return;
    } finally {
      setBusy(false);
    }
    onNotice(undefined);
    setEditing(undefined);
    refocus();
    await queries.invalidateQueries({ queryKey: ["finance"] });
  }

  const goal = goalRows[at];
  const move = (step: number) => setCursor(Math.max(0, Math.min(at + step, goalRows.length - 1)));
  const actions: Record<string, (() => void) | undefined> = {
    n: () => setEditing({ kind: "plan" }),
    g: () => setEditing({ kind: "goal" }),
    j: () => move(1),
    k: () => move(-1),
    ...assignKeys(goal, goals.data, today, run),
    e: goal === undefined ? undefined : () => setEditing({ kind: "goal", id: goal.id }),
  };
  /** Post a proposal as it is, or open the form for one with nothing to match by. */
  const confirm = (proposal: Proposal) => {
    if (proposal.payee_id == null && !proposal.text) {
      setEditing({ kind: "plan", draft: planOf(proposal) });
      return;
    }
    void run(() => writePlan(planOf(proposal), today));
  };
  const cancel = () => {
    setEditing(undefined);
    refocus();
  };
  keys.current = (key) => {
    // While a form is open the tab's keys rest, Escape aside, which leaves it.
    if (editing !== undefined) {
      if (key === "Escape") cancel();
      return true;
    }
    const proposal = proposals.data?.[PROPOSAL_KEYS.indexOf(key)];
    const act = PROPOSAL_KEYS.includes(key) && proposal ? () => confirm(proposal) : actions[key];
    if (act === undefined) return false;
    act();
    return true;
  };

  const error = plans.error ?? dues.error ?? proposals.error ?? goals.error;
  return (
    <div className="finance-plans">
      {error ? <p role="alert">{error.message}</p> : null}
      <Forms
        editing={editing}
        plans={plans.data ?? []}
        goals={goals.data}
        accounts={accounts.data ?? []}
        categories={categories.data ?? []}
        today={today}
        run={run}
        onCancel={cancel}
      />
      <div className="finance-plans-columns">
        <div className="finance-plans-column">
          {goals.data === undefined ? null : (
            <GoalList
              goals={goals.data}
              at={at}
              today={today}
              left={budget.data === undefined ? undefined : Number(budget.data.unreserved.total)}
              busy={busy}
              onSelect={setCursor}
              onAssign={(goal) => void run(() => assignGoal(goal.id, today))}
              onUndo={(goal) => void run(() => undoAssign(goal.id, today))}
              onEdit={(goal) => setEditing({ kind: "goal", id: goal.id })}
              onNew={() => setEditing({ kind: "goal" })}
            />
          )}
          <Upcoming dues={dues.data ?? []} month={month} />
        </div>
        <div className="finance-plans-column">
          <Proposals proposals={proposals.data ?? []} busy={busy} onConfirm={confirm} />
          <Plans
            plans={plans.data ?? []}
            onEdit={(plan) => setEditing({ kind: "plan", id: plan.id })}
            onNew={() => setEditing({ kind: "plan" })}
          />
        </div>
      </div>
      <Forecast today={today} />
    </div>
  );
}
