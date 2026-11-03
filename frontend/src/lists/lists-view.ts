/**
 * What the screen and the store work out from a list, with no storage and no network:
 * the list as the server gave it with the queued writes laid over, the request a queued
 * write makes against a list as it reads now, the count a write checks, and the texts the
 * suggestions come from. The store keeps the queue and makes the calls.
 */

import { linkFor, personOf } from "./lists-person";
import type { Item, ListData, Op, Snapshot } from "./lists-store";

const MAX_SUGGESTIONS = 5;

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
 */
export function requestFor(
  op: Op,
  list: ListData,
  day: string,
): { path: string; body: object } | null {
  const path = listPath(op.list);
  if (op.kind === "add") return { path: `${path}/items`, body: { text: op.text, sha: list.sha } };
  if (list.sha === null) return null;
  if (op.kind === "clear") return { path: `${path}/clear`, body: { sha: list.sha } };
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
  return { path: `${path}/tick`, body: { line: item.line, done: op.done, sha: list.sha, day } };
}

/**
 * The line an assign is for: its text, and the person it showed when picked. Two lines can
 * share a text, so the person is what tells them apart.
 */
function shownAs(item: Item, op: { text: string; from: string | null }): boolean {
  return item.text === op.text && personOf(item.assignee) === op.from;
}

function applyOp(items: Item[], op: Op, me: string | null): Item[] {
  if (op.kind === "add")
    return [
      ...items,
      { line: -1, text: op.text, done: false, assignee: null, ticked_by: null, ticked_at: null },
    ];
  if (op.kind === "clear") return items.filter((item) => !item.done);
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
  return items.map((item, n) => (n === at ? { ...item, done: op.done, ...tick } : item));
}

/** A list as the screen shows it: the server's copy with the queued writes laid over. */
export function viewOf(snap: Snapshot, list: string): Item[] {
  let items = snap.lists[list]?.items ?? [];
  for (const op of snap.queue) if (op.list === list) items = applyOp(items, op, snap.me);
  return items;
}

// The server's field reader (`todo_fields.py`, the port of the editor's `readFields`), copied
// because the lists app may not import src/lib; `lists-store.test.ts` holds it to the same cases.
const STOP = "📅|📆|🗓|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🏁|🆔|⛔|⏲|⏱";
const DATE = String.raw`️?[ \t]+(\d{4}-\d{2}-\d{2})`;
const ONE_WORD = String.raw`️?[ \t]+(?!${STOP}|🔁)(\S+)`;
const BLOCK = String.raw`\^[\w-]+[ \t]*(?:\n|$)`;
const ENDS = String.raw`(?=[ \t]+(?:${STOP}|🔁|👤|#|${BLOCK})|[ \t]*\n|[ \t]*$)`;
const BLOCKED_BY = new RegExp(`⛔${ONE_WORD}`);
const READ_ORDER = [
  `(?:📅|📆|🗓)${DATE}`,
  `⏳${DATE}`,
  `🛫${DATE}`,
  "(🔺|⏫|🔼|🔽|⏬)️?",
  String.raw`🔁️?[ \t]+(.+?)(?=[ \t]*(?:${STOP}|👤|#)|[ \t]+${BLOCK}|[ \t]*\n|[ \t]*$)`,
  String.raw`🏁️?[ \t]+(keep|delete)(?=[ \t\n]|$)`,
  `➕${DATE}`,
  `✅${DATE}`,
  `❌${DATE}`,
  `⏲${ONE_WORD}`,
  `⏱${ONE_WORD}`,
  `🆔${ONE_WORD}`,
]
  .map((source) => new RegExp(source))
  .concat([
    BLOCKED_BY,
    new RegExp(String.raw`👤${DATE}(?:[ \t]+(.+?))??${ENDS}`),
    new RegExp(
      String.raw`👤️?[ \t]+(?![ \t])(?!\d{4}-\d{2}-\d{2}(?:[ \t]|$)|${STOP}|🔁|👤|#|${BLOCK})(.+?)${ENDS}`,
    ),
  ]);
const SPANS = /\[\[[^[\]\n]+\]\]|\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]*`|<!--[^>\n][^\n]*?-->/g;
// Where a field was taken out, so a value read after it stops there.
const CUT = "\n";

/** The text and its mask with the first match of `pattern` that carries a value cut out, or null. */
function cut([text, mask]: [string, string], pattern: RegExp): [string, string] | null {
  const found = pattern.exec(mask);
  if (found === null || found.slice(1).every((value) => value === undefined)) return null;
  const end = found.index + found[0].length;
  return [
    text.slice(0, found.index) + CUT + text.slice(end),
    mask.slice(0, found.index) + CUT + mask.slice(end),
  ];
}

/** A todo's words with every field out, in the reader's order; only `⛔` repeats. */
function readWords(rest: string): string {
  let pair: [string, string] = [
    rest,
    rest.replace(SPANS, (span) => span.replace(/[^ \t]/g, "\u00A0")),
  ];
  for (const pattern of READ_ORDER) {
    for (
      let next = cut(pair, pattern);
      next !== null;
      next = pattern === BLOCKED_BY ? cut(pair, pattern) : null
    ) {
      pair = next;
    }
  }
  return pair[0].replaceAll(CUT, "").replace(/[ \t]+/g, " ");
}

/**
 * The text the server keeps for an item, which is what a list shows and what the
 * count compares against: `share.add` writes `" ".join(text.split())`, and `share.words`
 * reads it with every field out and no trailing `^block-id`.
 */
function shownText(text: string): string {
  const words = text.split(/\s+/).filter(Boolean).join(" ");
  return readWords(words)
    .trim()
    .replace(/(?:^|[ \t]+)\^[\w-]+$/, "")
    .trim();
}

/** How many open items a text would show as on the list: what a write's answer is checked against. */
export function openCount(list: ListData, text: string): number {
  const shown = shownText(text);
  return list.items.filter((item) => !item.done && item.text === shown).length;
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
