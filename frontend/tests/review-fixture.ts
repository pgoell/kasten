import type { SearchHit } from "@/lib/api";
import type { DeckNote } from "@/lib/review/review";

export const TODAY = "2026-08-13";

export function hits(path: string, lines: string[]): SearchHit[] {
  return lines.map((text, at) => ({ path, line: at + 1, text }));
}

/** One note of these lines, as the overview reads it once fetched. */
export function note(path: string, lines: string[]): DeckNote[] {
  return [{ path, text: lines.join("\n") }];
}

/** One note of this text. */
export function one(path: string, text: string): DeckNote[] {
  return [{ path, text }];
}
