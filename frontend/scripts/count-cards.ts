/**
 * Cards per deck over a vault, or the overview's time on one note.
 *
 * A change to which lines `parseCards` reads as code (#664) can drop or add
 * cards in the live vault without a test noticing. Run this on main and on the
 * branch over a copy of the vault and diff the two outputs. It counts cards per
 * deck as `parseCards` reads them, over every .md under the dir (archive too),
 * so not the overview's numbers: no parent-deck rollup, no #review whole notes.
 * `--cards` prints every card on its own line instead, because a count per deck
 * missed a card cut short and a schedule lost while the totals held.
 *
 *   bun scripts/count-cards.ts <vault dir>
 *   bun scripts/count-cards.ts --cards <vault dir>
 *   bun scripts/count-cards.ts --time <note file>
 *
 * The walk skips a `.jj` or `.git` directory, which a copy of the vault may hold.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { noteName } from "@/lib/note-path";
import { decksFrom } from "@/lib/review/review";
import { parseCards } from "@/lib/review/srs";

const [first, second] = process.argv.slice(2);

/** Every .md under `dir`, sorted, so two runs list notes in the same order. */
function notesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".md"))
    .filter((path) => !path.split("/").some((part) => part === ".jj" || part === ".git"))
    .sort();
}

// Backslashes first, or the `\n` written for a newline would read back as one.
function escaped(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\t", "\\t");
}

if (first === "--cards" && second !== undefined) {
  for (const path of notesUnder(second)) {
    const cards = parseCards(readFileSync(join(second, path), "utf8"), noteName(path));
    for (const card of cards.sort((a, b) => a.from - b.from)) {
      const held = card.held ? `${card.held.due},${card.held.interval},${card.held.ease}` : "-";
      const fields = [path, card.from, card.to, card.decks.join(","), escaped(card.front)];
      fields.push(escaped(card.back), held, card.parked ?? "-", card.cloze ?? "-");
      console.log(fields.join("\t"));
    }
  }
} else if (first === "--time" && second !== undefined) {
  const notes = [{ path: second, text: readFileSync(second, "utf8") }];
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 5; i++) decksFrom(notes, today);
  const runs: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    decksFrom(notes, today);
    runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  console.log(`median ${runs[10]?.toFixed(2)} ms, min ${runs[0]?.toFixed(2)} ms`);
} else if (first !== undefined) {
  // A card in two decks counts in each, and once in the total.
  const counts = new Map<string, number>();
  let total = 0;
  for (const path of notesUnder(first)) {
    const text = readFileSync(join(first, path), "utf8");
    for (const card of parseCards(text, noteName(path))) {
      if (card.decks.length > 0) total++;
      for (const deck of card.decks) counts.set(deck, (counts.get(deck) ?? 0) + 1);
    }
  }
  for (const [deck, n] of [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    console.log(`${deck}\t${n}`);
  }
  console.log(`total\t${total}`);
} else {
  console.error("usage: bun scripts/count-cards.ts [--cards] <vault dir> | --time <note file>");
  process.exit(1);
}
