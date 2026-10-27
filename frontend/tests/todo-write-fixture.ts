import { parseTodo, type Todo } from "@/lib/todo/todo";
import type { Closed } from "@/lib/todo/todo-blocked";

/** The day every test below is written against, so no assertion expires. */
export const TODAY = "2026-08-10";

export const DAILY_PATH = "01 Periodic/00 Daily/2026-08-10.md";

/** Today's daily note as the vault holds it, log line and all. */
export const DAILY = [
  "# 2026-08-10 Monday",
  "",
  "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
  "",
  "## Done",
  "- ✅ 2026-08-10 read the spec [[projects/kasten]] kt-000001",
  "",
  "## Time",
  "- 09:12-10:32 read the spec",
  "",
].join("\n");

/** The same day's note before anything was logged in it. */
export const FRESH_DAILY = [
  "# 2026-08-10 Monday",
  "",
  "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
  "",
].join("\n");

export const NOTE_PATH = "projects/kasten.md";

/** The note the todos live in. Line 7 is doing, line 8 is open. */
export const NOTE = [
  "---",
  "id: 019874aa",
  "---",
  "",
  "# kasten",
  "",
  "- [/] wire up the pane 📅 2026-08-14 ⏫ #kasten",
  "- [ ] buy milk",
  "",
].join("\n");

/** A todo out of a line, for the tests that want a record rather than a string. */
export function todo(line: string): Todo {
  const found = parseTodo(line);
  if (found === null) throw new Error(`not a todo: ${line}`);
  return found;
}

/** A resolver that has never heard of a blocker, which reads as still open. */
export const UNKNOWN: Closed = () => undefined;
