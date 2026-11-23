import type { TodoRow } from "@/lib/core/api";

/** The day every todo-view test is written against, so no assertion expires. */
export const TODAY = "2026-11-22";

/** A store row with every field empty, open and made today; `fields` fills what a test needs. */
export function row(id: string, words: string, fields: Partial<TodoRow> = {}): TodoRow {
  return {
    id,
    words,
    description: null,
    state: "open",
    tags: [...words.matchAll(/#[^\s#]+/g)].map((found) => found[0]),
    note: "01 Periodic/00 Daily/2026-11-22.md",
    shared_list: null,
    project: null,
    parent_id: null,
    position: 0,
    round_of: null,
    epic: false,
    epic_id: null,
    blocked_by: [],
    repeat: null,
    on_completion: null,
    priority: null,
    planned: null,
    hold_until: null,
    due: null,
    due_hard: false,
    assignee: null,
    waiting_on: null,
    waiting_since: null,
    look_again: null,
    remind_at: null,
    estimate: null,
    worked: null,
    created: TODAY,
    done: null,
    cancelled: null,
    updated: `${TODAY}T08:00:00Z`,
    version: 1,
    ...fields,
  };
}
