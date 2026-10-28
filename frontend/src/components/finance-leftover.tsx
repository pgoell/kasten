import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { positive } from "@/components/finance-budget-tab";
import { fetchGoals, moveLeftover } from "@/lib/finance/finance-plans-api";
import { money } from "@/lib/finance/finance-words";

/**
 * "Move into a goal": a goal and an amount of what the limits left over, all of it at first.
 * The goal reserves that much more of its saving account, so the money has to be there; a
 * refusal says what the account can still take. The move is dated today's month.
 */
export function MoveLeftover({
  left,
  today,
}: {
  /** What the limits left, less every move before, as the budget gives it. */
  left: number;
  today: string;
}) {
  const queries = useQueryClient();
  const goals = useQuery({
    queryKey: ["finance", "goals", today],
    queryFn: () => fetchGoals(today),
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState("");
  const [amount, setAmount] = useState("");
  const [refused, setRefused] = useState<string>();
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // The focus goes back to the button that opened the form once it closes, rather than to the page.
  useEffect(() => {
    if (wasOpen.current && !open) opener.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const choices = goals.data?.goals ?? [];
  if (left <= 0 || choices.length === 0) return null;
  if (!open) {
    return (
      <button
        ref={opener}
        type="button"
        className="finance-pane-button finance-small finance-leftover-open"
        onClick={() => {
          setGoal(String(choices[0]?.id ?? ""));
          setAmount(left.toFixed(2).replace(".", ","));
          setRefused(undefined);
          setOpen(true);
        }}
      >
        Move into a goal
      </button>
    );
  }

  const value = positive(amount);
  const valid = value !== undefined && value <= left;

  async function move() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await moveLeftover(Number(goal), (value ?? 0).toFixed(2), today);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setRefused(error.message);
      return;
    } finally {
      setBusy(false);
    }
    setOpen(false);
    await queries.invalidateQueries({ queryKey: ["finance"] });
  }

  return (
    <form
      className="finance-leftover"
      onSubmit={(event) => {
        event.preventDefault();
        void move();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }}
    >
      <label>
        Goal
        <select value={goal} onChange={(event) => setGoal(event.target.value)}>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {`Amount €, at most ${money(left)}`}
        <input
          // biome-ignore lint/a11y/noAutofocus: the form opens on a tap meant to type into it.
          autoFocus
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <div className="finance-form-actions">
        <button
          type="submit"
          className="finance-pane-button finance-small"
          disabled={!valid || busy}
        >
          Move
        </button>
        <button
          type="button"
          className="finance-pane-button finance-small"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
        {valid ? null : (
          <span className="finance-muted">{`an amount above 0 and at most ${money(left)}`}</span>
        )}
      </div>
      {refused === undefined ? null : (
        <p role="alert" className="finance-status-text-over">
          {refused}
        </p>
      )}
    </form>
  );
}
