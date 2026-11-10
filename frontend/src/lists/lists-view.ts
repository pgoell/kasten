/**
 * What the screen and the store work out from a list, with no storage and no network:
 * the list as the server gave it with the queued writes laid over, the request a queued
 * write makes against a list as it reads now, the count a write checks, and the texts the
 * suggestions come from. The store keeps the queue and makes the calls.
 */

import type { Item, ListData, Op, Snapshot } from "./lists-store";

const MAX_SUGGESTIONS = 5;

/**
 * A whole `[[target]]`, with an optional `#heading` and `|alias` after the target.
 * Written here rather than imported from the shared link helpers, which would pull the
 * editor's packages into this phone bundle.
 */
const WHOLE_LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;

/**
 * The person an assignee names: the last path segment of its link, with any alias dropped as
 * #809's chip drops it, so both name the same note. Plain text is itself.
 */
export function personOf(assignee: string | null): string | null {
  if (assignee === null) return null;
  const text = assignee.trim();
  const target = WHOLE_LINK.exec(text)?.[1];
  if (target === undefined) return text || null;
  return target.slice(target.lastIndexOf("/") + 1).trim() || null;
}

/** The words an assign writes on the line: `[[Name]]`, the link #809's chip reads. */
export const linkFor = (name: string) => `[[${name}]]`;

export const listPath = (name: string) => `/lists/${encodeURIComponent(name)}`;

/** The date on this device's clock, as a tick sends it (#1300). */
export function localDay(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The write one op makes against the list as it reads now, or none when the
 * list already says what the op asks for. A tick names its line from this read,
 * so a line that moved since the op was queued is found by its text instead.
 * `day` stands in for a tick an older build queued with no day of its own.
 */
export function requestFor(
  op: Op,
  list: ListData,
  day: string,
): { path: string; body: object } | null {
  const path = listPath(op.list);
  if (op.kind === "add") {
    // A part whose item is gone is added as an item, so the words are not lost.
    const under = op.under === undefined ? undefined : itemOf(list.items, op.under)?.line;
    return { path: `${path}/items`, body: { text: op.text, sha: list.sha, under } };
  }
  if (list.sha === null) return null;
  if (op.kind === "clear") return { path: `${path}/clear`, body: { sha: list.sha } };
  if (op.kind === "edit" || op.kind === "delete") return lineWrite(op, list.items, path, list.sha);
  if (op.kind === "assign") {
    const item = list.items.find((found) => shownAs(found, op));
    // Nothing to write when the line already names the person asked for, or no line is left that showed `from`.
    if (!item || personOf(item.assignee) === op.assignee) return null;
    return {
      path: `${path}/assign`,
      body: { line: item.line, assignee: op.assignee, sha: list.sha },
    };
  }
  const item = list.items.find((found) => found.text === op.text && found.done !== op.done);
  if (!item) return null;
  return {
    path: `${path}/tick`,
    body: { line: item.line, done: op.done, sha: list.sha, day: op.day ?? day },
  };
}

/** An edit or a delete, by the line that shows its text now; none when no line does. */
function lineWrite(
  op: Extract<Op, { kind: "edit" | "delete" }>,
  items: Item[],
  path: string,
  sha: string,
): { path: string; body: object } | null {
  const item = itemOf(items, op.text);
  if (!item) return null;
  if (op.kind === "delete") return { path: `${path}/delete`, body: { line: item.line, sha } };
  if (item.text === op.to) return null;
  return { path: `${path}/edit`, body: { line: item.line, text: op.to, sha } };
}

/**
 * The line an assign is for: its text, and the person it showed when picked. Two lines can
 * share a text, so the person is what tells them apart.
 */
function shownAs(item: Item, op: { text: string; from: string | null }): boolean {
  return item.text === op.text && personOf(item.assignee) === op.from;
}

/** The item a write by text is for: an open one first, as the person most often means it. */
function itemOf(items: Item[], text: string): Item | undefined {
  return (
    items.find((item) => item.text === text && !item.done) ??
    items.find((item) => item.text === text)
  );
}

/** The index after the last part under `items[at]`, parts of parts too. */
function endOf(items: Item[], at: number): number {
  const depth = items[at]?.depth ?? 0;
  let end = at + 1;
  while (end < items.length && (items[end]?.depth ?? 0) > depth) end += 1;
  return end;
}

/** The list without the item showing `text` and its parts: a delete as the screen shows it. */
export function without(items: Item[], text: string): Item[] {
  const item = itemOf(items, text);
  const at = item ? items.indexOf(item) : -1;
  return at < 0 ? items : [...items.slice(0, at), ...items.slice(endOf(items, at))];
}

/** An item and the parts drawn under it. */
export type Group = { item: Item; parts: Item[] };

/** The list as items with their parts, which open and done split at the margin only. */
export function groupsOf(items: Item[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (item.depth > 0 && last) last.parts.push(item);
    else groups.push({ item, parts: [] });
  }
  return groups;
}

/** `1/3` after an item with parts: closed parts of all under it, parts of parts too. Null without. */
export function countOf(items: Item[], at: number): string | null {
  const parts = items.slice(at + 1, endOf(items, at));
  if (parts.length === 0) return null;
  return `${parts.filter((part) => part.done).length}/${parts.length}`;
}

function added(items: Item[], op: Extract<Op, { kind: "add" }>): Item[] {
  const parent = op.under === undefined ? undefined : itemOf(items, op.under);
  const at = parent ? endOf(items, items.indexOf(parent)) : items.length;
  const item: Item = {
    line: -1,
    depth: parent ? parent.depth + 1 : 0,
    text: op.text,
    done: false,
    assignee: null,
    ticked_by: null,
    ticked_at: null,
  };
  return [...items.slice(0, at), item, ...items.slice(at)];
}

function applyOp(items: Item[], op: Op, me: string | null): Item[] {
  if (op.kind === "add") return added(items, op);
  if (op.kind === "delete") return without(items, op.text);
  if (op.kind === "edit") {
    const item = itemOf(items, op.text);
    return items.map((found) => (found === item ? { ...found, text: op.to } : found));
  }
  if (op.kind === "clear") return cleared(items);
  if (op.kind === "assign") {
    const at = items.findIndex((item) => shownAs(item, op));
    const assignee = op.assignee === null ? null : linkFor(op.assignee);
    return at < 0 ? items : items.map((item, n) => (n === at ? { ...item, assignee } : item));
  }
  const at = items.findIndex((item) => item.text === op.text && item.done !== op.done);
  if (at < 0) return items;
  // A tick shows its time and person at once, so it sorts where the server will put it.
  const tick = op.done
    ? { ticked_by: me, ticked_at: new Date().toISOString() }
    : { ticked_by: null, ticked_at: null };
  // A tick takes the open parts along, as the server's does; an untick leaves them.
  const end = op.done ? endOf(items, at) : at + 1;
  return items.map((item, n) =>
    n === at || (n > at && n < end && !item.done) ? { ...item, done: op.done, ...tick } : item,
  );
}

/** What Leeren leaves: an item done with every part done goes whole, the rest stays. */
function cleared(items: Item[]): Item[] {
  return groupsOf(items)
    .filter(({ item, parts }) => !(item.done && parts.every((part) => part.done)))
    .flatMap(({ item, parts }) => [item, ...parts]);
}

/** A list as the screen shows it: the server's copy with the queued writes laid over. */
export function viewOf(snap: Snapshot, list: string): Item[] {
  let items = snap.lists[list]?.items ?? [];
  for (const op of snap.queue) if (op.list === list) items = applyOp(items, op, snap.me);
  return items;
}

/** How many open items show `kept`, the text the server said an add keeps: what a lost answer is checked against. */
export function openCount(list: ListData, kept: string): number {
  return list.items.filter((item) => !item.done && item.text === kept).length;
}

const fold = (text: string) => text.toLocaleLowerCase("de-DE");

/**
 * The texts offered for what is typed: earlier items by their first letters
 * first, then by a letter run inside them. An item open on the list now is not
 * offered, since the point is to add the one that is missing.
 */
export function suggestionsFor(snap: Snapshot, list: string, typed: string): string[] {
  const needle = fold(typed.trim());
  if (!needle) return [];
  const open = new Set(
    viewOf(snap, list)
      .filter((item) => !item.done)
      .map((item) => fold(item.text)),
  );
  const found = new Map<string, string>();
  for (const text of snap.seen[list] ?? []) {
    if (!open.has(fold(text))) found.set(fold(text), text);
  }
  const all = [...found.entries()];
  const prefix = all.filter(([key]) => key.startsWith(needle)).map(([, text]) => text);
  const inside = all
    .filter(([key]) => !key.startsWith(needle) && key.includes(needle))
    .map(([, text]) => text);
  return [...prefix, ...inside].slice(0, MAX_SUGGESTIONS);
}
