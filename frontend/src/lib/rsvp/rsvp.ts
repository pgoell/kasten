/**
 * RSVP reading: the words and what the player needs to know of them, not where they came from.
 * Every source hands over runs (`rsvp-sources.ts`); everything after that is the same for all four.
 */

/** One word of the text, in reading order, and where it sits in its source. */
export interface Word {
  text: string;
  /** The last word of a sentence. A paragraph's last word is one too. */
  sentence: boolean;
  /** The last word of a paragraph. */
  paragraph: boolean;
  /** The part of the source: the pdf page or the book section, counted from zero; 0 for a note or a page. */
  section: number;
  /** Where the word starts in that part's text: the note source, the page text or the section's text nodes. */
  offset: number;
}

/**
 * Text as a source hands it over: a stretch of its own characters from `from`, or a paragraph break.
 * A word may span two stretches (`**bo**ld`), so they are read as one stream.
 */
export type Run = { text: string; from: number } | "break";

/**
 * Words ending in a full stop that end no sentence. Short on purpose: a list
 * that guesses wrong pauses where it should not, which costs less than a
 * sentence that runs into the next.
 */
const ABBREVIATIONS = new Set([
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "prof.",
  "st.",
  "vs.",
  "cf.",
  "ca.",
  "nr.",
  "bzw.",
  "vgl.",
]);

/** A full stop, a question or an exclamation, with any closing quote or bracket after it. */
const SENTENCE_END = /[.!?…]["'”’»)\]]*$/;

/** A comma, a semicolon, a colon or a dash: a short pause, not a full one. */
const CLAUSE_END = /[,;:–—]["'”’»)\]]*$/;

function endsSentence(word: string): boolean {
  if (!SENTENCE_END.test(word)) return false;
  // `e.g.`, `z.B.` and `U.S.`: letters each with its own stop.
  if (/^(?:\p{L}\.){2,}$/u.test(word)) return false;
  return !ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * The words of `runs`, each marked where a sentence or a paragraph ends. A paragraph also ends at
 * a blank line; `lines` makes every line end one, as `innerText` spells a block's end.
 */
export function wordsOf(runs: Iterable<Run>, section: number, lines = false): Word[] {
  const words: Word[] = [];
  let word = "";
  let from = 0;
  /** Newlines seen since the last word, which say whether a paragraph ended. */
  let newlines = 0;

  function endParagraph() {
    const last = words[words.length - 1];
    if (last !== undefined) {
      last.paragraph = true;
      last.sentence = true;
    }
  }

  function flush() {
    if (word === "") return;
    words.push({
      text: word,
      sentence: endsSentence(word),
      paragraph: false,
      section,
      offset: from,
    });
    word = "";
    newlines = 0;
  }

  function space(character: string) {
    flush();
    if (character !== "\n") return;
    newlines += 1;
    if (newlines >= (lines ? 1 : 2)) endParagraph();
  }

  for (const run of runs) {
    if (run === "break") {
      flush();
      endParagraph();
      continue;
    }
    for (let at = 0; at < run.text.length; at += 1) {
      const character = run.text[at] as string;
      if (/\s/.test(character)) space(character);
      else {
        if (word === "") from = run.from + at;
        word += character;
      }
    }
  }
  flush();
  endParagraph();
  return words;
}

/**
 * Where the chunk starting at `start` ends, exclusive: up to `size` words, and
 * never past the end of a sentence, so a chunk does not hold the end of one and
 * the start of the next.
 */
export function chunkEnd(words: readonly Word[], start: number, size: number): number {
  let end = start;
  while (end < words.length && end - start < size) {
    end += 1;
    if (words[end - 1]?.sentence) break;
  }
  return end;
}

/**
 * The letter the eye fixes on, counted in code points from the word's start.
 *
 * A little left of the middle, the way the RSVP readers place it, and counted
 * over the letters alone, so the quote in front of a word does not move it.
 */
export function orp(word: string): number {
  const letters = Array.from(word);
  const lead = letters.findIndex((letter) => /[\p{L}\p{N}]/u.test(letter));
  if (lead === -1) return Math.floor((letters.length - 1) / 2);
  let trail = letters.length;
  while (trail > lead && !/[\p{L}\p{N}]/u.test(letters[trail - 1] as string)) trail -= 1;
  const core = trail - lead;
  const into = core <= 1 ? 0 : core <= 5 ? 1 : core <= 9 ? 2 : core <= 13 ? 3 : 4;
  return lead + into;
}

/**
 * The fixed letter of a chunk. One word keeps its `orp`; a longer chunk takes the letter nearest
 * its middle, since the first word's letter would leave the rest hanging to the right.
 */
export function chunkFix(text: string): number {
  if (!text.includes(" ")) return orp(text);
  const letters = Array.from(text);
  const middle = Math.floor((letters.length - 1) / 2);
  for (let step = 0; step < letters.length; step += 1) {
    for (const at of [middle - step, middle + step]) {
      if (/[\p{L}\p{N}]/u.test(letters[at] ?? "")) return at;
    }
  }
  return middle;
}

/** What the player is set to. Kept per device under `kasten.rsvp`. */
export interface RsvpSettings {
  /** Words per minute. */
  wpm: number;
  /** Words per chunk, 1 to 3. */
  chunk: number;
  /** The size of the word on screen, in px. */
  size: number;
  /** How many words' time a sentence end adds; a clause adds half, a paragraph twice. */
  pause: number;
}

export const DEFAULT_SETTINGS: RsvpSettings = { wpm: 300, chunk: 1, size: 40, pause: 1 };

/** The ranges each setting is held to, and the step a key or a button moves it by. */
export const LIMITS = {
  wpm: { min: 100, max: 1000, step: 25 },
  chunk: { min: 1, max: 3, step: 1 },
  size: { min: 20, max: 96, step: 4 },
  pause: { min: 0, max: 3, step: 0.5 },
} as const;

/** `value` held to the range of `name`, or the default where it is no number. */
export function clampSetting(name: keyof RsvpSettings, value: unknown): number {
  const { min, max } = LIMITS[name];
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SETTINGS[name];
  return Math.min(max, Math.max(min, name === "chunk" ? Math.round(value) : value));
}

/** Settings read back from storage, every field checked, since anything can be in there. */
export function settingsOf(raw: unknown): RsvpSettings {
  const held = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    wpm: clampSetting("wpm", held.wpm),
    chunk: clampSetting("chunk", held.chunk),
    size: clampSetting("size", held.size),
    pause: clampSetting("pause", held.pause),
  };
}

/**
 * How long the chunk from `start` to `end` stays on screen, in ms: one word's time per word, plus a pause
 * where it ends a clause, a sentence or a paragraph, as a reader's voice would.
 */
export function delay(
  words: readonly Word[],
  start: number,
  end: number,
  settings: Pick<RsvpSettings, "wpm" | "pause">,
): number {
  const one = 60_000 / settings.wpm;
  const last = words[end - 1];
  let extra = 0;
  if (last?.paragraph) extra = 2 * settings.pause;
  else if (last?.sentence) extra = settings.pause;
  else if (last !== undefined && CLAUSE_END.test(last.text)) extra = settings.pause / 2;
  return one * (end - start + extra);
}

type Unit = "sentence" | "paragraph";

/** The first word of the sentence or paragraph holding word `index`. */
function startOf(words: readonly Word[], index: number, unit: Unit): number {
  let at = index;
  while (at > 0 && !words[at - 1]?.[unit]) at -= 1;
  return at;
}

/**
 * Where `h` and `H` go: the start of the sentence or paragraph being read, or
 * of the one before when the reader is already at the start, the way a
 * player's back button restarts the track before it skips to the last.
 */
export function back(words: readonly Word[], index: number, unit: Unit): number {
  const start = startOf(words, index, unit);
  return start < index ? start : startOf(words, Math.max(index - 1, 0), unit);
}

/** Where `l` and `L` go: the first word after the sentence or paragraph being read. */
export function forward(words: readonly Word[], index: number, unit: Unit): number {
  let at = index;
  while (at < words.length - 1 && !words[at]?.[unit]) at += 1;
  return Math.min(at + 1, Math.max(words.length - 1, 0));
}

/** How many words the anchor holds: the saved one and four after it. */
const ANCHOR_WORDS = 5;

/** A saved place: the word, the length of the list it was in, and the words there. */
export interface Place {
  word: number;
  words: number;
  anchor: string;
}

/** The anchor at word `index`: that word and the few after it, space-joined. */
export function anchorAt(words: readonly Word[], index: number): string {
  return words
    .slice(index, index + ANCHOR_WORDS)
    .map((word) => word.text)
    .join(" ");
}

/** The place word `index` of `words` is, as it is saved. */
export function placeAt(words: readonly Word[], index: number): Place {
  return { word: index, words: words.length, anchor: anchorAt(words, index) };
}

/**
 * Where a saved place lands in `words`, which may differ from the list it was saved from. The same text
 * gives the saved index; a changed one gives the nearest occurrence of the saved words, or the top if none.
 */
export function resume(place: Place | null, words: readonly Word[]): number {
  if (place === null || words.length === 0) return 0;
  if (place.words === words.length && anchorAt(words, place.word) === place.anchor) {
    return place.word;
  }
  // As many words as the anchor holds: one saved within the last four words of
  // the text holds fewer than five, and text added after it would add words
  // here that the saved anchor never had.
  const wanted = place.anchor.split(" ");
  const holds = (at: number) =>
    words
      .slice(at, at + wanted.length)
      .map((word) => word.text)
      .join(" ") === place.anchor;
  let best = -1;
  for (let at = 0; at < words.length; at += 1) {
    if (words[at]?.text !== wanted[0] || !holds(at)) continue;
    if (best === -1 || Math.abs(at - place.word) < Math.abs(best - place.word)) best = at;
  }
  return best === -1 ? 0 : best;
}

/**
 * The word a point in the source falls in, or the first after it, or the last
 * word where the point is past them all.
 */
export function indexAt(words: readonly Word[], section: number, offset: number): number {
  const after = words.findIndex(
    (word) => word.section > section || (word.section === section && word.offset >= offset),
  );
  if (after === -1) return Math.max(words.length - 1, 0);
  const before = words[after - 1];
  // The point is inside the word before, a cursor in the middle of it.
  if (
    before !== undefined &&
    before.section === section &&
    before.offset + before.text.length > offset
  ) {
    return after - 1;
  }
  return after;
}

/** The first word of `section`, or of the next one holding any. */
export function firstOf(words: readonly Word[], section: number): number {
  return indexAt(words, section, 0);
}

/**
 * Where a selected passage starts, searched from word `from` on and then from the top, or null.
 * A selection may cut a word at either end, so its first and last words need only partly match.
 */
export function findQuote(words: readonly Word[], quote: string, from = 0): number | null {
  const wanted = quote
    .split(/\s+/)
    .filter((part) => part !== "")
    .slice(0, ANCHOR_WORDS);
  if (wanted.length === 0) return null;

  function matches(at: number): boolean {
    return wanted.every((part, index) => {
      const text = words[at + index]?.text;
      if (text === undefined) return false;
      if (wanted.length === 1) return text.includes(part);
      if (index === 0) return text.endsWith(part);
      if (index === wanted.length - 1) return text.startsWith(part);
      return text === part;
    });
  }

  for (let at = from; at < words.length; at += 1) if (matches(at)) return at;
  for (let at = 0; at < Math.min(from, words.length); at += 1) if (matches(at)) return at;
  return null;
}

/** What a pane hands the reader: its text, and the place a press should start from. */
export interface RsvpSource {
  /** The vault path the place is saved under: the note, the page, the pdf or the book's file. */
  path: string;
  /** The text's words, in reading order. `keep` turns false once the reader has closed. */
  words(keep: () => boolean): Promise<Word[]>;
  /** Where "from here" starts: the selection, the cursor or the page on screen. Null resumes. */
  here(words: Word[]): Promise<number | null> | number | null;
  /** A book's two copies between this place and its `reading:`. Only a book has one. */
  book?: {
    /** Move the book to `word` and write it as `reading:`. */
    toReading(word: Word): Promise<void>;
    /** The word `reading:` points at. */
    fromReading(words: Word[]): Promise<number>;
  };
}
