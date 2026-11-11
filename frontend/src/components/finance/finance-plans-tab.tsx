import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useState } from "react";
import { Contracts } from "@/components/finance/finance-contracts";
import { Forecast } from "@/components/finance/finance-forecast";
import { assignKeys, GoalForm, GoalList } from "@/components/finance/finance-goals";
import { PlanForm, scheduleName } from "@/components/finance/finance-plan-form";
import type { TabKeys } from "@/components/finance/finance-sort-bar";
import { type Category, fetchCategories } from "@/lib/panes/finance/finance-api";
import { type Account, fetchAccounts, fetchBudget } from "@/lib/panes/finance/finance-budget-api";
import {
  assignGoal,
  type Due,
  deleteGoal,
  deletePlan,
  fetchGoals,
  fetchPlans,
  fetchProposals,
  fetchUpcoming,
  type Goals,
  makeContract,
  type Plan,
  type PlanIn,
  type Proposal,
  planOf,
  undoAssign,
  writeGoal,
  writePlan,
} from "@/lib/panes/finance/finance-plans-api";
import { money, monthName } from "@/lib/panes/finance/finance-words";

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

/** A proposal that cannot be posted as it is, with no payee or text to match by. */
function unmatchable(proposal: Proposal): boolean {
  return proposal.payee_id == null && !proposal.text;
}

/** A row's button that starts the contract note for its plan. */
function ContractButton({
  name,
  onPress,
  disabled = false,
}: {
  name: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="finance-pane-button finance-small"
      aria-label={`Make a contract note for ${name}`}
      title={disabled ? "Confirm it as a plan first: it has nothing to match by" : undefined}
      disabled={disabled}
      onClick={onPress}
    >
      Contract
    </button>
  );
}

function Proposals({
  proposals,
  busy,
  onConfirm,
  onContract,
}: {
  proposals: Proposal[];
  busy: boolean;
  onConfirm: (p: Proposal) => void;
  onContract: (p: Proposal) => void;
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
            <span className="finance-plans-buttons">
              <button
                type="button"
                className="finance-pane-button finance-small"
                aria-label={`Confirm ${proposal.name}`}
                disabled={busy}
                onClick={() => onConfirm(proposal)}
              >
                {index < PROPOSAL_KEYS.length ? <kbd>{PROPOSAL_KEYS[index]}</kbd> : null} Confirm
              </button>
              <ContractButton
                name={proposal.name}
                onPress={() => onContract(proposal)}
                disabled={busy || unmatchable(proposal)}
              />
            </span>
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
  onContract,
}: {
  plans: Plan[];
  onEdit: (p: Plan) => void;
  onNew: () => void;
  onContract: (p: Plan) => void;
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
            <span className="finance-plans-buttons">
              <button
                type="button"
                className="finance-pane-button finance-small"
                aria-label={`Edit ${plan.name}`}
                onClick={() => onEdit(plan)}
              >
                Edit
              </button>
              <ContractButton name={plan.name} onPress={() => onContract(plan)} />
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="finance-pane-button finance-small" onClick={onNew}>
        <kbd>n</kbd> New plan
      </button>
    </section>
  );
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
  const [made, setMade] = useState<string>();
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
    if (unmatchable(proposal)) {
      setEditing({ kind: "plan", draft: planOf(proposal) });
      return;
    }
    void run(() => writePlan(planOf(proposal), today));
  };
  const contract = (from: Plan | Proposal) =>
    void run(async () => setMade((await makeContract(from, today)).path));
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
          <Proposals
            proposals={proposals.data ?? []}
            busy={busy}
            onConfirm={confirm}
            onContract={contract}
          />
          <Plans
            plans={plans.data ?? []}
            onEdit={(plan) => setEditing({ kind: "plan", id: plan.id })}
            onNew={() => setEditing({ kind: "plan" })}
            onContract={contract}
          />
          <Contracts today={today} made={made} />
        </div>
      </div>
      <Forecast today={today} />
    </div>
  );
}
