/**
 * The `#flashcards` tag: what makes a note a deck, and what puts one card in
 * another deck beside it.
 *
 * Two readers need this and they read different things. `review.ts` sees the
 * lines one rg pass matched and counts the vault's decks off them; `srs.ts`
 * sees a note whole and parses the cards a sitting asks. The rule about what a
 * tag means has to be the same in both, so it is written once here.
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

/** `#flashcards`, and the deck it names. A bare tag names none and reads as "". */
const DECK_TAG = /#flashcards(?:\/([^\s#]+))?/g;

/**
 * Deck tags at the head of a line that goes on into something else.
 *
 * The head and not anywhere on the line, which is the plugin's rule and the
 * only place a tag can sit without landing in the middle of a card's answer.
 * A line holding nothing but tags is the note's, so the space and the `\S` are
 * what tell the two apart.
 */
const HEAD_TAGS = /^[ \t]*((?:#flashcards(?:\/[^\s#]+)?[ \t]+)+)(?=\S)/;

/** Every deck named on the line. A bare `#flashcards` is the empty name. */
export function deckTags(text: string): string[] {
  return [...text.matchAll(DECK_TAG)].map((found) => found[1] ?? "");
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
 * Any tag and not only `#flashcards`, the shape being `tag.ts`'s: what this
 * answers is whether the line is worth reading as part of a question, and a
 * line of topics is no more part of one than the deck tag is.
 */
const ONLY_TAGS = /^[ \t]*(?:#[\p{L}_][\p{L}\p{N}_/-]*[ \t]*)+$/u;

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
