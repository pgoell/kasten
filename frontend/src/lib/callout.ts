/**
 * Obsidian's callouts: a blockquote whose first line opens with `[!type]`. Case is
 * ignored, an alias draws as its type, and an unknown type draws as a note.
 */

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
  /** Characters before the title: `[!type]`, the fold sign and the spaces. */
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
