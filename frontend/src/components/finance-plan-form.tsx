import { useState } from "react";
import { amountOf, positive } from "@/components/finance-budget-tab";
import type { Category } from "@/lib/finance-api";
import type { Account } from "@/lib/finance-budget-api";
import type { PlanIn } from "@/lib/finance-plans-api";

/** The schedules the form offers, as `every_months`; null falls due once. */
export const SCHEDULES: { every: number | null; label: string }[] = [
  { every: 1, label: "Monthly" },
  { every: 2, label: "Every 2 months" },
  { every: 3, label: "Every 3 months" },
  { every: 4, label: "Every 4 months" },
  { every: 6, label: "Every 6 months" },
  { every: 12, label: "Yearly" },
  { every: null, label: "Once" },
];

export function scheduleName(every: number | null | undefined): string {
  return (
    SCHEDULES.find((schedule) => schedule.every === (every ?? null))?.label ??
    `Every ${every} months`
  );
}

/** A cost as typed, a positive figure, signed the way the API keeps it unless it is money in. */
function signed(text: string, incoming: boolean): string {
  const amount = Math.abs(Number(amountOf(text) ?? "0"));
  return (incoming ? amount : -amount).toFixed(2);
}

/** The form's fields as text, from the plan or, for a new one, empty. */
function draftOf(plan: PlanIn | undefined, today: string, accounts: Account[]) {
  return {
    name: plan?.name ?? "",
    account: String(plan?.account_id ?? accounts[0]?.id ?? ""),
    text: plan?.text ?? "",
    amount: plan === undefined ? "" : String(Math.abs(Number(plan.amount))),
    incoming: plan !== undefined && Number(plan.amount) > 0,
    tolerance: plan === undefined ? "0" : String(Number(plan.tolerance ?? 0)),
    every: plan === undefined ? "1" : String(plan.every_months ?? "once"),
    category: String(plan?.category_id ?? ""),
    start: plan?.start ?? today,
    end: plan?.end ?? "",
  };
}

/**
 * A plan needs a name, an amount above nothing and something to match by; a give or take that
 * is no number would go out as nothing.
 */
function validDraft(
  draft: ReturnType<typeof draftOf>,
  tolerance: number,
  hasPayee: boolean,
): boolean {
  return (
    draft.name.trim() !== "" &&
    positive(draft.amount) !== undefined &&
    Number.isFinite(tolerance) &&
    tolerance >= 0 &&
    (hasPayee || draft.text.trim() !== "")
  );
}

interface PlanFormProps {
  plan: PlanIn | undefined;
  today: string;
  accounts: Account[];
  categories: Category[];
  onSave: (plan: PlanIn) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

/**
 * A plan's fields in a form: what it is called, what to match, how much, how often, its category
 * and dates. A plan made from a proposal keeps the payee it matches by; one made here matches by
 * its text. Enter in a field saves, Escape leaves the form.
 */
export function PlanForm({
  plan,
  today,
  accounts,
  categories,
  onSave,
  onCancel,
  onDelete,
}: PlanFormProps) {
  const [draft, setDraft] = useState(() => draftOf(plan, today, accounts));
  const set = (field: keyof typeof draft) => (value: string | boolean) =>
    setDraft({ ...draft, [field]: value });

  const tolerance = draft.tolerance.trim() === "" ? 0 : Number(amountOf(draft.tolerance));
  const valid = validDraft(draft, tolerance, plan?.payee_id != null);

  function save() {
    if (!valid) return;
    onSave({
      name: draft.name.trim(),
      account_id: Number(draft.account),
      payee_id: plan?.payee_id ?? null,
      text: draft.text.trim() || null,
      amount: signed(draft.amount, draft.incoming),
      tolerance: tolerance.toFixed(2),
      every_months: draft.every === "once" ? null : Number(draft.every),
      category_id: draft.category === "" ? null : Number(draft.category),
      start: draft.start,
      end: draft.end || null,
    });
  }

  return (
    <form
      className="finance-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
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
        Account
        <select value={draft.account} onChange={(e) => set("account")(e.target.value)}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Text to match
        <input
          value={draft.text}
          placeholder={plan?.payee_id == null ? "in the purpose or name" : "matched by its payee"}
          onChange={(e) => set("text")(e.target.value)}
        />
      </label>
      <label>
        Amount €
        <input
          inputMode="decimal"
          value={draft.amount}
          onChange={(e) => set("amount")(e.target.value)}
        />
      </label>
      <label className="finance-form-check">
        <input
          type="checkbox"
          checked={draft.incoming}
          onChange={(e) => set("incoming")(e.target.checked)}
        />
        Money in
      </label>
      <label>
        Give or take €
        <input
          inputMode="decimal"
          value={draft.tolerance}
          onChange={(e) => set("tolerance")(e.target.value)}
        />
      </label>
      <label>
        How often
        <select value={draft.every} onChange={(e) => set("every")(e.target.value)}>
          {SCHEDULES.map(({ every, label }) => (
            <option key={label} value={every ?? "once"}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Category
        <select value={draft.category} onChange={(e) => set("category")(e.target.value)}>
          <option value="">None</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        First due
        <input type="date" value={draft.start} onChange={(e) => set("start")(e.target.value)} />
      </label>
      <label>
        Last due
        <input type="date" value={draft.end} onChange={(e) => set("end")(e.target.value)} />
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
        {valid ? null : (
          <span className="finance-muted">a name, an amount above 0 and a text to match</span>
        )}
      </div>
    </form>
  );
}
