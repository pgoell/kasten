/**
 * The `#flashcards` tag: what makes a note a deck, and what puts one card in
 * another deck beside it.
 *
 * `srs.ts` reads it for every card it parses, which the overview counts and the
 * sitting asks, and `review.ts` for the decks above a deck. `srs.ts` finds a
 * note's tags with the editor's parser and a card's own at the head of its
 * line, and asks this file what deck each one names. The rule about what a tag
 * means is written once here.
 *
 * ```markdown
 * #flashcards/databases
 *
 * What is a stored procedure?::A named block of SQL …
 *
 * #flashcards/dbt How does dbt relate to stored procedures?::The same pattern …
 * ```
 *
 * A tag on a line of its own is the note's and every card in it is asked under
 * that deck. A tag at the head of a line that goes on into a card is that
 * card's, and it adds a deck rather than replacing the note's, so the card
 * above is asked in `databases` and in `dbt` both.
 *
 * That last part is where kasten parts from obsidian-spaced-repetition, which
 * borrowed everything else about this format. There a card's own tags replace
 * the note's and a tag on its own line governs only the cards under it. Adding
 * is the reading that answers what the tag is written for: a card about two
 * things is in both decks, and saying so should not cost you the deck the note
 * already put it in. The plugin still reads the vault, and files that one card
 * under `dbt` alone.
 */

import { TAG_CHARS, TAG_SOURCE, tagsOf } from "@/lib/tag-rule";

/**
 * `#flashcards`, and the deck it names after the slash. A tag by `tag-rule.ts`'s
 * rule and no other shape, so `(#flashcards/es)` names `es` and `#flashcardsx`
 * names nothing, as the editor draws them.
 */
const DECK_TAG = /^#flashcards(?:\/(.*))?$/u;

/**
 * Deck tags at the head of a line that goes on into something else.
 *
 * The head and not anywhere on the line, which is the plugin's rule and the
 * only place a tag can sit without landing in the middle of a card's answer.
 * A line holding nothing but tags is the note's, so the space and the `\S` are
 * what tell the two apart. Each tag runs on tag characters only, so it ends
 * where `deckTags` ends it, and a tag closed by `)` heads no card.
 */
const HEAD_TAGS = new RegExp(
  String.raw`^[ \t]*((?:#flashcards(?:\/${TAG_CHARS}*)?[ \t]+)+)(?=\S)`,
  "u",
);

/** The deck one tag names, or null where it names none. A bare `#flashcards` is the empty name. */
export function deckOf(tag: string): string | null {
  const deck = DECK_TAG.exec(tag);
  return deck === null ? null : (deck[1] ?? "");
}

/** Every deck named on the line. */
export function deckTags(text: string): string[] {
  return tagsOf(text).flatMap(({ tag }) => {
    const deck = deckOf(tag);
    return deck === null ? [] : [deck];
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
 *
 * Any tag and not only `#flashcards`, by `tag-rule.ts`'s rule: what this
 * answers is whether the line is worth reading as part of a question, and a
 * line of topics is no more part of one than the deck tag is. The tags stand
 * apart, since a hash glued to a tag is no tag.
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
 * A deck and every deck above it, `databases/postgres` sitting in `databases`.
 *
 * The slashes in a tag are a path everywhere else in the vault, so they are one
 * here too: naming a deck `databases/postgres` files its cards under
 * `databases` as well, and the overview draws both rows. Anki spells its
 * subdecks the same way once `anki.py` has read them, so an imported tree
 * arrives nested rather than flat.
 */
export function deckPath(name: string): string[] {
  const parts = name.split("/");
  return parts.map((_, at) => parts.slice(0, at + 1).join("/"));
}

/** Whether a card filed under `filed` is asked in a sitting of `deck`. */
export function inDeck(filed: string, deck: string): boolean {
  return filed === deck || filed.startsWith(`${deck}/`);
}
