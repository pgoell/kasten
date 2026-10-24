/**
 * The parts of the log pane's Today and Entries that draw one row: a kind's or a food
 * field's reading with its meter, and the form that edits an entry. The pane owns the
 * state and the writes; these only show what they are handed.
 */

import { Fragment, type RefObject } from "react";
import type { Line } from "@/components/log-trends";
import { share } from "@/components/log-trends";
import { overMax } from "@/lib/log-day";
import type { Goal } from "@/lib/log-kinds";
import { goalPhrase, grouped } from "@/lib/log-words";

/** The meals a food line names, in the order the pane groups them. `""` is no meal. */
export const MEALS = ["breakfast", "lunch", "dinner", "snack", ""] as const;

/** The row being edited, what its form holds, and why the last save was refused. */
export interface Editing {
  line: number;
  amount: string;
  meal: string;
  servings: string;
  why: string | null;
}

/**
 * One row of Today: a kind's or a food field's name and total, and where it has a goal, a
 * meter and the goal in words. A passed max and a met floor are said in words too, so the
 * colour on the row is never the only sign.
 */
export function Reading({
  name,
  meter,
  total,
  tail,
  goal,
}: {
  name: string;
  /** The meter's label: the kind's name, or the food field's, as the pane has always named them. */
  meter: string;
  total: number;
  tail: string;
  goal: Goal | undefined;
}) {
  const over = goal !== undefined && overMax(total, goal);
  const met = goal?.type === "floor" && total >= goal.value;
  const state = over ? " log-pane-over" : met ? " log-pane-met" : "";
  return (
    <li className={`log-pane-reading${state}`}>
      <span className="log-pane-name">{name}</span>
      <span className="log-pane-total">{`${grouped(total)}${tail}`}</span>
      {goal === undefined ? null : (
        <>
          {/* biome-ignore lint/a11y/useSemanticElements: the bar is a styled div, and role meter carries its values for a reader. */}
          <div
            role="meter"
            aria-label={meter}
            aria-valuemin={0}
            aria-valuemax={goal.value}
            aria-valuenow={total}
            className="log-pane-meter"
          >
            <div className="log-pane-meter-fill" style={{ width: `${share(total, goal)}%` }} />
          </div>
          <span className="log-pane-goal">{goalPhrase(total, goal)}</span>
        </>
      )}
    </li>
  );
}

/** The kcal of a meal's food lines, which is what its heading shows. */
function kcalOf(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + (line.kind === "food" ? (line.kcal ?? 0) : 0), 0);
}

/**
 * The day's entries by group, each a row button that opens its edit. The cursor's row is
 * marked, and the row being edited is its form. The pane owns the cursor and the writes.
 */
export function EntryList({
  groups,
  rows,
  at,
  editing,
  formRef,
  onOpen,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  groups: { title: string | null; lines: Line[] }[];
  rows: Line[];
  at: number;
  editing: Editing | null;
  formRef: RefObject<HTMLFormElement | null>;
  onOpen: (line: Line) => void;
  onChange: (next: Partial<Editing>) => void;
  onSave: (line: Line, edit: Editing) => void;
  onCancel: () => void;
  onDelete: (line: Line) => void;
}) {
  return (
    <ul className="log-pane-list">
      {groups.map((group) => (
        <Fragment key={group.title ?? "drinks"}>
          {group.title === null ? null : (
            <li className="log-pane-group">
              <h3>{group.title}</h3>
              <span className="log-pane-meal-kcal">{`${grouped(kcalOf(group.lines))} kcal`}</span>
            </li>
          )}
          {group.lines.map((line) => {
            const selected = rows.indexOf(line) === at;
            return (
              // The cursor's row is marked with aria-selected, which a list item does not take by role.
              // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the cursor row is the one marked, as the spec names.
              <li
                key={line.line}
                aria-selected={selected}
                className={selected ? "log-pane-row-item log-pane-selected" : "log-pane-row-item"}
              >
                {editing !== null && editing.line === line.line ? (
                  <EditForm
                    line={line}
                    edit={editing}
                    formRef={formRef}
                    onChange={onChange}
                    onSave={() => onSave(line, editing)}
                    onCancel={onCancel}
                    onDelete={() => onDelete(line)}
                  />
                ) : (
                  <button
                    type="button"
                    className="log-pane-line k-row"
                    onClick={() => onOpen(line)}
                  >
                    {line.text.replace(/^- /, "")}
                  </button>
                )}
              </li>
            );
          })}
        </Fragment>
      ))}
    </ul>
  );
}

export function EditForm({
  line,
  edit,
  formRef,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  line: Line;
  edit: Editing;
  formRef: RefObject<HTMLFormElement | null>;
  onChange: (next: Partial<Editing>) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <form
      ref={formRef}
      className="log-pane-edit"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
      // Escape leaves the form here, and stops there, so the pane does not also act on it.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onCancel();
      }}
    >
      {line.kind === "food" ? (
        <>
          <label className="log-pane-field">
            <span>Meal</span>
            <select
              aria-label="Meal"
              value={edit.meal}
              onChange={(event) => onChange({ meal: event.target.value })}
            >
              {MEALS.map((meal) => (
                <option key={meal} value={meal}>
                  {meal === "" ? "no meal" : meal}
                </option>
              ))}
            </select>
          </label>
          <label className="log-pane-field">
            <span>Servings</span>
            <input
              aria-label="Servings"
              inputMode="decimal"
              value={edit.servings}
              onChange={(event) => onChange({ servings: event.target.value })}
            />
          </label>
        </>
      ) : (
        <label className="log-pane-field">
          <span>Amount</span>
          <input
            aria-label="Amount"
            value={edit.amount}
            onChange={(event) => onChange({ amount: event.target.value })}
          />
        </label>
      )}
      {edit.why === null ? null : (
        <p role="alert" className="log-pane-why">
          {edit.why}
        </p>
      )}
      <div className="log-pane-row">
        <button type="submit" className="log-pane-button">
          Save
        </button>
        <button type="button" className="log-pane-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="log-pane-button" onClick={onDelete}>
          Delete
        </button>
      </div>
    </form>
  );
}
