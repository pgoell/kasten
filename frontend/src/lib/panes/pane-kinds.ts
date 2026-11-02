/**
 * Every kind a pane can hold, one row per `Pane` field. A new kind is a row here plus the component
 * that draws it; the type below fails to compile while a field has no row (#978).
 */

import { noteName } from "@/lib/note-path";

/** One pane, and whichever note is open in it. */
export interface Pane {
  id: string;
  /** The note it holds, absent while the pane is empty. */
  path?: string;
  /** Line the editor opens on, which only a search hit names. */
  line?: number;
  /**
   * How many times the pane was opened at `line`. A repeat open still sends the cursor back,
   * since the cursor may have moved off the line.
   */
  jump?: number;
  /**
   * The herdr session it holds, absent unless this is a terminal pane. Not a union, since that
   * would rewrite every `pane.path` read for an invariant the route already keeps.
   */
  term?: string;
  /** Set on the todo list pane, absent otherwise. A field of its own, not a union, as `term` is. */
  todos?: boolean;
  /** Set on the log pane, absent otherwise. A boolean: the log opens on today and moves by day. */
  log?: boolean;
  /** The overview's pane. */
  overview?: boolean;
  /** The finance pane's. */
  finance?: boolean;
  /**
   * The literature note whose book this pane reads, absent otherwise. The note's path, since the
   * reader swaps its suffix to find the epub.
   */
  book?: string;
  /** The note whose practice exam this pane sits, absent otherwise. The note's path. */
  exam?: string;
  /** Set on the review pane, absent otherwise. A boolean: the pane picks its own deck. */
  review?: boolean;
  /**
   * The image this pane shows, absent otherwise. Its own path, not a note's: any number of notes
   * reference an image and none owns it.
   */
  image?: string;
  /**
   * The pdf this pane shows and the page it opened at, absent otherwise. Its own path, since any
   * number of notes name a pdf. `opened` counts opens, as `jump` does, so a repeat still moves it.
   */
  pdf?: { path: string; page?: number; opened: number };
  /** The HTML page this pane shows, absent otherwise. Its own path: no note owns a page. */
  html?: string;
  /** The heading a followed link named, where the page opens. Absent otherwise. */
  anchor?: string;
  /**
   * The note whose video this pane plays, absent otherwise. The note's path, not the address, so a
   * folder move that rewrites `path` carries the player with it.
   */
  video?: string;
  /**
   * The person note this pane shows the card for, absent otherwise. The note's path, so a move
   * carries the card with it.
   */
  person?: string;
  /** The note whose jj history this pane lists, absent otherwise. Its path, so moves carry it. */
  history?: string;
  /**
   * Set on the graph pane, absent otherwise. `around` names the note a local graph is drawn around,
   * and is absent for the whole vault. An object, so no empty string stands in for nothing.
   */
  graph?: { around?: string };
  /** Set on the chat pane, absent otherwise. A boolean: every chat pane views one session. */
  chat?: boolean;
}

/** The icon a pane's tab and header draw for it. Most kinds draw a page. */
export type PaneKind = "page" | "pdf" | "book" | "review" | "graph" | "video";

/** The fields that say what a pane holds. `line`, `jump` and `anchor` only say where in it. */
export type KindField = Exclude<keyof Pane, "id" | "line" | "jump" | "anchor">;

export type Check = (value: unknown) => boolean;

interface Row<K extends KindField> {
  /** Whether a value read back from browser storage is one this field may hold. */
  saved: Check;
  icon: PaneKind;
  tab: (value: NonNullable<Pane[K]>) => string;
  /** The vault path it shows, which the tree marks and `<leader>E` reaches. */
  path?: (value: NonNullable<Pane[K]>) => string | undefined;
  /** Whether `q` empties it at once. A note saves first: its editor holds the only unsaved copy. */
  clears: boolean;
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const isString: Check = (value) => typeof value === "string";
const isTrue: Check = (value) => value === true;
const within = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const flag = (tab: string): Row<KindField> => ({
  saved: isTrue,
  icon: "page",
  tab: () => tab,
  clears: true,
});
const named = (icon: PaneKind = "page"): Row<KindField> => ({
  saved: isString,
  icon,
  tab: (note) => noteName(note as string),
  path: (note) => note as string,
  clears: true,
});
const file = (): Row<KindField> => ({
  saved: isString,
  icon: "page",
  tab: (path) => baseName(path as string),
  path: (path) => path as string,
  clears: true,
});

export const PANE_KINDS: { [K in KindField]: Row<K> } = {
  // Obsidian names a tab by the note it holds.
  path: { ...named(), clears: false },
  // A terminal names its herdr session, which is the thing you named it.
  term: { saved: isString, icon: "page", tab: (session) => session, clears: true },
  todos: flag("todos"),
  log: flag("log"),
  overview: flag("overview"),
  finance: flag("finance"),
  // A reader, a player, an exam and a card are each named by the note they sit beside (#363).
  book: named("book"),
  exam: named("review"),
  review: { ...flag("review"), icon: "review" },
  // A pdf, an image and a page are files and not notes, so named by the file (#361).
  image: file(),
  pdf: {
    saved: (value) =>
      isObject(value) &&
      within(value, ["path", "page"]) &&
      isString(value.path) &&
      (!("page" in value) || (Number.isInteger(value.page) && Number(value.page) > 0)),
    icon: "pdf",
    tab: (pdf) => baseName(pdf.path),
    path: (pdf) => pdf.path,
    clears: true,
  },
  html: file(),
  video: named("video"),
  person: named(),
  // Not the note's name alone, which the note's own tab already carries.
  history: { ...named(), tab: (note) => `history of ${noteName(note)}` },
  graph: {
    saved: (value) =>
      isObject(value) &&
      within(value, ["around"]) &&
      (!("around" in value) || isString(value.around)),
    icon: "graph",
    tab: ({ around }) => (around === undefined ? "graph view" : `graph of ${noteName(around)}`),
    path: ({ around }) => around,
    clears: true,
  },
  chat: flag("chat"),
};

const FIELDS = Object.keys(PANE_KINDS) as KindField[];

/** The field naming what the pane holds, or undefined while it is empty and shows Today. */
export function heldKind(pane: Pick<Pane, KindField>): KindField | undefined {
  return FIELDS.find((field) => pane[field] !== undefined && pane[field] !== false);
}

/** Reads the held field's row with its value, the one place the field and its type part ways. */
function read<T>(pane: Pane, use: (row: Row<KindField>, value: never) => T): T | undefined {
  const field = heldKind(pane);
  return field === undefined
    ? undefined
    : use(PANE_KINDS[field] as Row<KindField>, pane[field] as never);
}

/** What a pane shows, for its icon. An empty pane draws a page. */
export function paneKind(pane: Pane): PaneKind {
  return read(pane, (row) => row.icon) ?? "page";
}

/** The vault path of what the pane shows. A pane holds one kind at most. */
export function panePath(pane: Pane): string | undefined {
  return read(pane, (row, value) => row.path?.(value));
}

/** What a tab holding this pane is called. Obsidian calls a tab with nothing in it yet New tab. */
export function paneTitle(pane: Pane): string {
  return read(pane, (row, value) => row.tab(value)) ?? "New tab";
}

/** Whether `value`, read from browser storage, is a pane `saveWorkspace` could have written. */
export function isSavedPane(value: Record<string, unknown>): boolean {
  return (
    isString(value.id) &&
    Object.entries(value).every(
      ([key, field]) =>
        key === "id" ||
        (Object.hasOwn(PANE_KINDS, key) && PANE_KINDS[key as KindField].saved(field)),
    )
  );
}

/**
 * A file's name without its folder or its suffix: `x/my plan.pdf` is `my plan`. The last suffix
 * only, where `noteName` takes off `.md` alone: `report.v2.pdf` is `report.v2`.
 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
}
