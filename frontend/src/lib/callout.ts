/**
 * Obsidian's callouts: a blockquote whose first line opens with `[!type]`.
 *
 * `> [!warning]- Mind the gap` is a warning, folded shut, titled "Mind the
 * gap". The type is read without regard to case, as Obsidian reads it, and an
 * alias is drawn as the type it stands for. A type Obsidian does not know is
 * still a callout, drawn as a note, which is what Obsidian does with one.
 */

/** The types Obsidian ships, each with the aliases it answers to. */
const TYPES: Record<string, string[]> = {
  note: [],
  abstract: ["summary", "tldr"],
  info: [],
  todo: [],
  tip: ["hint", "important"],
  success: ["check", "done"],
  question: ["help", "faq"],
  warning: ["caution", "attention"],
  failure: ["fail", "missing"],
  danger: ["error"],
  bug: [],
  example: [],
  quote: ["cite"],
};

const KIND = new Map<string, string>(
  Object.entries(TYPES).flatMap(([kind, aliases]) =>
    [kind, ...aliases].map((name) => [name, kind] as const),
  ),
);

/** `[!type]`, the fold sign and the title, as Obsidian reads the first line. */
const HEADER = /^\[!([^\]\s]+)\]([+-]?)[ \t]*(.*)$/;

export interface Callout {
  /** The type as written, lower-cased: `tldr`, `warning`, `mytype`. */
  type: string;
  /** The type it is drawn as, an alias resolved: `abstract`, `warning`, `note`. */
  kind: string;
  /** `+` opens folded open, `-` folded shut, nothing does not fold. */
  fold: "" | "+" | "-";
  /** The title after the type, or the type itself with a capital when none is given. */
  title: string;
  /** Whether the title was written, rather than made from the type. */
  titled: boolean;
  /** How many characters `[!type]` and the fold sign and the spaces after them take. */
  length: number;
}

/** Reads the text after a blockquote's `> `, or null when it opens no callout. */
export function parseCallout(text: string): Callout | null {
  const match = HEADER.exec(text);
  if (!match) return null;
  const [, written, fold, rest] = match as unknown as [string, string, "" | "+" | "-", string];
  const type = written.toLowerCase();
  const title = rest.trimEnd();
  return {
    type,
    kind: KIND.get(type) ?? "note",
    fold,
    title: title === "" ? written.charAt(0).toUpperCase() + written.slice(1).toLowerCase() : title,
    titled: title !== "",
    length: text.length - rest.length,
  };
}
