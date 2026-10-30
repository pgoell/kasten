/**
 * The `#flashcards` tag: what makes a note a deck, and what files one card in a second deck.
 * A card's head tag adds a deck to the note's. Obsidian-spaced-repetition replaces them, the only place kasten parts from it.
 */

import { TAG_CHARS, TAG_SOURCE, tagsOf } from "@/lib/tag-rule";

/**
 * `#flashcards`, and the deck it names after the slash. A tag by `tag-rule.ts`'s
 * rule and no other shape, so `(#flashcards/es)` names `es` and `#flashcardsx`
 * names nothing, as the editor draws them.
 */
const DECK_TAG = /^#flashcards(?:\/(.*))?$/u;

/**
 * Deck tags at the head of a line that goes on into a card, never anywhere on it: that is
 * the one place a tag cannot land inside a card's answer. A line of tags alone is the note's.
 */
const HEAD_TAGS = new RegExp(
  String.raw`^[ \t]*((?:#flashcards(?:\/${TAG_CHARS}*)?[ \t]+)+)(?=\S)`,
  "u",
);

/** Every deck named on the line. A bare `#flashcards` is the empty name. */
export function deckTags(text: string): string[] {
  return tagsOf(text).flatMap(({ tag }) => {
    const deck = DECK_TAG.exec(tag);
    return deck === null ? [] : [deck[1] ?? ""];
  });
}

/** The decks the card this line opens is in, or null where it opens none. */
export function cardTags(text: string): string[] | null {
  const head = HEAD_TAGS.exec(text);
  return head === null ? null : deckTags(head[1] ?? "");
}

/** `text` with a card's own tags taken off, which is how the card is asked. */
export function withoutTags(text: string): string {
  return text.replace(HEAD_TAGS, "");
}

/**
 * A line holding tags and nothing else, which is the note's rather than a card's.
 * Any tag, not only `#flashcards`, as `tag-rule.ts` reads one. Tags must be space-separated.
 */
const ONLY_TAGS = new RegExp(String.raw`^[ \t]*${TAG_SOURCE}(?:[ \t]+${TAG_SOURCE})*[ \t]*$`, "u");

/** Whether the line is tags and nothing else. */
export function onlyTags(text: string): boolean {
  return ONLY_TAGS.test(text);
}

/** The deck a tag names, a bare one being called after the note holding it. */
export function deckName(tag: string, note: string): string {
  return tag === "" ? note : tag;
}

/**
 * A deck and every deck above it: `databases/postgres` sits in `databases` too.
 * The slashes are a path here as elsewhere in the vault. Anki subdecks nest the same way.
 */
export function deckPath(name: string): string[] {
  const parts = name.split("/");
  return parts.map((_, at) => parts.slice(0, at + 1).join("/"));
}

/** Whether a card filed under `filed` is asked in a sitting of `deck`. */
export function inDeck(filed: string, deck: string): boolean {
  return filed === deck || filed.startsWith(`${deck}/`);
}
