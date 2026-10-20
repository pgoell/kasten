import { useEffect } from "react";
import type { SearchHit } from "@/lib/api";
import type { TodoState } from "@/lib/todo";

/**
 * The lines of every listed todo in the hit's note with its very words, the
 * hit's own among them, in order.
 *
 * From the listing the row was drawn from, not a fresh one: a write that finds
 * two identical lines picks the one at the row's rank among them, and only the
 * listing the reader saw says which rank that was.
 */
function twinsOf(listed: SearchHit[], hit: SearchHit): number[] {
  return listed
    .filter((row) => row.path === hit.path && row.text === hit.text)
    .map((row) => row.line)
    .sort((a, b) => a - b);
}

/**
 * The writes a row's keys, taps and drops make, each handed the twins of its
 * line where it has any, and the row the `@` palette entry reads as it opens.
 */
export function useTodoTwins(o: {
  data: SearchHit[] | undefined;
  cycle(hit: SearchHit, state?: TodoState, twins?: number[]): void;
  timer(hit: SearchHit, twins?: number[]): void;
  agent(hit: SearchHit, twins?: number[]): void;
  cursorRow: { current: { hit: SearchHit; twins?: number[] } | null } | undefined;
  at: { hit: SearchHit } | undefined;
  /** The board, or the picker: where `@` would do nothing. */
  idle: boolean;
}) {
  const { data, cycle, timer, agent, cursorRow, at, idle } = o;

  // Every press in here that writes a state, a timer or the agent's tag, key,
  // tap or drop on the board, goes through these, so none leaves the twins off.
  // Only where there are twins: one line or none is the row's own, and the
  // press goes out with the arguments it was made with.
  const onCycle = (...args: [hit: SearchHit, state?: TodoState]) => {
    const twins = twinsOf(data ?? [], args[0]);
    if (twins.length > 1) cycle(args[0], args[1], twins);
    else cycle(...args);
  };
  const onTimer = (hit: SearchHit) => {
    const twins = twinsOf(data ?? [], hit);
    if (twins.length > 1) timer(hit, twins);
    else timer(hit);
  };
  const onAgent = (hit: SearchHit) => {
    const twins = twinsOf(data ?? [], hit);
    if (twins.length > 1) agent(hit, twins);
    else agent(hit);
  };

  // After every render, as `@` reads `at` at the press: none on the board,
  // which drops the key, or in the picker, which takes only its own.
  useEffect(() => {
    if (cursorRow === undefined) return;
    if (idle || at === undefined) {
      cursorRow.current = null;
    } else {
      const twins = twinsOf(data ?? [], at.hit);
      cursorRow.current = { hit: at.hit, twins: twins.length > 1 ? twins : undefined };
    }
    // A pane that loses the focus, or closes, leaves no row behind it.
    return () => {
      cursorRow.current = null;
    };
  });

  return { onCycle, onTimer, onAgent };
}
