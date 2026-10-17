import type { Mention } from "@/lib/api";
import { noteName } from "@/lib/note-path";
import { wikiLinkPath } from "@/lib/wikilink";

/**
 * The note with one unlinked mention turned into `linkText`, or null where the
 * line no longer says what the mention was read off.
 *
 * Spliced by the offsets the vault answered with and never found again by
 * matching: a line naming the note twice has two mentions, and a search for
 * the words would link whichever came first rather than the one pressed.
 * Null where the line moved or changed since the list was read, because the
 * offsets then point into somebody else's words.
 */
export function linkMention(text: string, mention: Mention, linkText: string): string | null {
  const lines = text.split("\n");
  const at = mention.line - 1;
  const line = lines[at];
  if (line !== mention.text) return null;
  lines[at] = line.slice(0, mention.start) + linkText + line.slice(mention.end);
  return lines.join("\n");
}

/**
 * The `[[link]]` a mention of `target` becomes, keeping the words as written.
 *
 * The bare name where the words are the name, an alias where case or an alias
 * of the note made the match, and the path spelled out where another note
 * shares the name, so the link always resolves to `target` and nothing else.
 */
export function mentionLinkText(mention: Mention, target: string, paths: string[]): string {
  const shown = mention.text.slice(mention.start, mention.end);
  const stem = noteName(target);
  const name = wikiLinkPath(stem, paths) === target ? stem : target.replace(/\.md$/, "");
  if (shown === name) return `[[${name}]]`;
  // An alias holding `|`, `[` or `]` would end the link early or open another
  // inside it, so the words go and the name alone is written. Rare in prose,
  // and a link that resolves is worth more than the words it showed.
  if (/[|[\]]/.test(shown)) return `[[${name}]]`;
  return `[[${name}|${shown}]]`;
}
