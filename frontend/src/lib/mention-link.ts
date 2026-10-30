import type { Mention } from "@/lib/api";
import { noteName } from "@/lib/note-path";
import { wikiLinkPath } from "@/lib/wikilink";

/**
 * The note with one unlinked mention turned into `linkText`, or null if its line has changed.
 * Spliced by the vault's offsets, not a search, since a line may name the note twice.
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
 * The `[[link]]` a mention of `target` becomes, keeping the words. The path is spelled out when
 * another note shares the name, so the link always resolves to `target`.
 */
export function mentionLinkText(mention: Mention, target: string, paths: string[]): string {
  const shown = mention.text.slice(mention.start, mention.end);
  const stem = noteName(target);
  const name = wikiLinkPath(stem, paths) === target ? stem : target.replace(/\.md$/, "");
  if (shown === name) return `[[${name}]]`;
  // An alias with `|`, `[` or `]` would break the link, so only the name is written.
  if (/[|[\]]/.test(shown)) return `[[${name}]]`;
  return `[[${name}|${shown}]]`;
}
