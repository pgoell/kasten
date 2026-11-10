import { isPerson } from "@/lib/notes/links/person";
import type { KindField } from "@/lib/panes/layout/pane-kinds";
import { noteVideos } from "@/lib/panes/video/video";
import { parseExam } from "@/lib/review/exam";
import {
  LEADER,
  LEADER_COLUMNS,
  LEADER_FOURS,
  LEADER_PREFIXES,
  type LeaderNeed,
  TAB_DIGITS,
} from "@/lib/ui/keys/leader-keys";

/**
 * Where Space was pressed, read off the screen when the which-key panel opens, so
 * it can leave out the keys that would do nothing there.
 */
export interface LeaderContext {
  /**
   * What the pane holds, `empty` for a pane showing Today. Undefined outside a
   * pane, such as the file tree, where every key a pane's contents decide is shown.
   */
  holds?: KindField | "empty";
  /** The note's text, when the editor opened the panel. */
  note?: string;
  /** What each pane of the tab holds, the opener's own among them. */
  tab: readonly string[];
}

/** Set on each pane leaf (`pane-layout.tsx`), so the panel need not reach into the layout. */
const HOLDS = "data-holds";

/** The context for a press of Space in `from`, with the note's text if the editor knows it. */
export function contextAt(from: Element | null, note?: string): LeaderContext {
  const tab = [...document.querySelectorAll(`[data-pane][${HOLDS}]`)].map(
    (pane) => pane.getAttribute(HOLDS) ?? "",
  );
  const holds = from?.closest(`[data-pane][${HOLDS}]`)?.getAttribute(HOLDS);
  return { holds: (holds ?? undefined) as LeaderContext["holds"], note, tab };
}

// The panes each need finds its work in: a vault path to reveal, a file to download, text to read.
const FILE = ["path", "book", "exam", "image", "pdf", "html", "video", "person", "history"];
const EXPORT = ["path", "exam", "image", "book"];
const READING = ["path", "html", "pdf", "book"];

/**
 * Whether a key with this need does something here. A note's text is only known
 * from the editor, so a note pane opened from anywhere else keeps its note keys.
 */
export function fits(needs: LeaderNeed | undefined, context: LeaderContext): boolean {
  // No pane on the page at all: nothing to go by, so every key shows.
  if (needs === undefined || context.tab.length === 0) return true;
  if (needs === "split") return context.tab.length > 1;
  if (needs === "player") return context.tab.includes("video");
  const { holds, note } = context;
  if (holds === undefined) return true;
  if (needs === "file") return FILE.includes(holds);
  if (needs === "export") return EXPORT.includes(holds);
  if (needs === "reading") return READING.includes(holds);
  if (holds !== "path") return false;
  if (note === undefined || needs === "note") return true;
  if (needs === "person") return isPerson(note);
  if (needs === "video") return noteVideos(note).length > 0;
  return parseExam(note) !== null;
}

/** A row of the panel. `shown` is the part of `key` still to type. */
export type PanelRow =
  | { kind: "key"; key: string; shown: string; label: string }
  | { kind: "group"; key: string; shown: string; label: string }
  | { kind: "four"; keys: readonly { key: string; label: string }[]; label: string }
  | { kind: "digits" };

export interface PanelColumn {
  title: string;
  rows: PanelRow[];
}

type Entry = { key: string; label: string; needs?: LeaderNeed };

/** Where a key lands once `typed` is pressed: a row of its own, or the group its next key opens. */
function rowOf(key: string, typed: string, entry: Entry): PanelRow {
  const next = key.slice(0, typed.length + 1);
  const shown = key.slice(typed.length);
  if (key === next) return { kind: "key", key, shown, label: entry.label };
  const label = LEADER_PREFIXES[next] ?? "More";
  return { kind: "group", key: next, shown: shown.slice(0, 1), label };
}

/** `h j k l` as one row before any key, unless only one of the four fits here. */
function fourOf(key: string, typed: string, fitting: readonly Entry[]): PanelRow | undefined {
  if (typed !== "") return undefined;
  const four = LEADER_FOURS.find((each) => each.keys.includes(key));
  if (four === undefined) return undefined;
  const keys = fitting.filter((each) => four.keys.includes(each.key));
  return keys.length > 1 ? { kind: "four", keys, label: four.label } : undefined;
}

/**
 * What the panel draws once `typed` is pressed: the keys one press away, and one
 * row for each group a further press opens. `hidden` says some key was left out.
 */
export function panelRows(
  typed: string,
  context: LeaderContext,
  edits: readonly Entry[] = [],
): { columns: PanelColumn[]; hidden: boolean } {
  const known = (key: string) =>
    LEADER.find((each) => each.key === key) ?? edits.find((each) => each.key === key);
  const all = LEADER_COLUMNS.flatMap((column) => column.keys).flatMap((key) => {
    const entry = known(key);
    return entry && key.startsWith(typed) && key !== typed ? [entry] : [];
  });
  const fitting = all.filter((entry) => fits(entry.needs, context));
  // A group or a four takes the place of its first key, and its other keys draw nothing.
  const drawn = new Set<string>();

  const rowFor = (key: string): PanelRow[] => {
    if (key === TAB_DIGITS) return typed === "" ? [{ kind: "digits" }] : [];
    const entry = fitting.find((each) => each.key === key);
    if (entry === undefined || drawn.has(key)) return [];
    const row = fourOf(key, typed, fitting) ?? rowOf(key, typed, entry);
    const covers =
      row.kind === "four"
        ? row.keys
        : fitting.filter((each) => row.kind === "group" && each.key.startsWith(row.key));
    for (const each of covers) drawn.add(each.key);
    return [row];
  };

  const columns = LEADER_COLUMNS.map(({ title, keys }) => ({ title, rows: keys.flatMap(rowFor) }));
  return {
    columns: columns.filter((column) => column.rows.length > 0),
    hidden: fitting.length < all.length,
  };
}
