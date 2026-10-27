import { cycleLine, parseTodo, type Todo } from "@/lib/todo/todo";

/** The day the press lands on, and the id it brings with it. */
export const TODAY = "2026-08-10";
export const FRESH = "kt-000001";

export function press(line: string): string {
  return cycleLine(line, TODAY, FRESH);
}

/** The spec's own line, which carries every field at once. */
export const EXAMPLE =
  "- [/] wire up the pane 📅 2026-08-14 ⏳ 2026-08-12 🛫 2026-08-11 ⏫ 🔁 every week ➕ 2026-08-09 ⏲ 2h ⏱ 1h20m 🆔 kt-3f9a2c ⛔ kt-8b1e04 #kasten";

/** The parse, which every case below expects to answer something. */
export function parsed(line: string): Todo {
  const todo = parseTodo(line);
  if (todo === null) throw new Error(`not a todo: ${line}`);
  return todo;
}
