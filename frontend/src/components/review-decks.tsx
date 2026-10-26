import { useQueries, useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ReviewImport } from "@/components/review-import";
import { fetchCards, fetchNote } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { readRetry } from "@/lib/read-retry";
import { type Deck, deckNotes, decksFrom } from "@/lib/review";
import { dayWords } from "@/lib/review-days";
import { useEntrance } from "@/lib/stagger";
import { useReviewLimits } from "@/lib/use-review-limits";

/**
 * The decks unfolded by hand, per browser.
 *
 * The open ones and not the folded ones, because folded is where every deck
 * below the top level starts: an imported Anki tree of two hundred subdecks
 * would otherwise open as two hundred rows.
 */
const FOLDS_KEY = "kasten.review.folds.1";

/** Blocked site data throws a `DOMException`, and a broken value is no list. */
function readUnfolded(): Set<string> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(FOLDS_KEY);
  } catch (error) {
    if (error instanceof DOMException) return new Set();
    throw error;
  }
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((name) => typeof name === "string")) {
      return new Set(parsed);
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return new Set();
}

function writeUnfolded(unfolded: Set<string>): void {
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify([...unfolded]));
  } catch (error) {
    // Blocked, or full. The fold still holds until the page goes.
    if (!(error instanceof DOMException)) throw error;
  }
}

/** How far under another deck this one sits, `databases/postgres` being one. */
function depthOf(name: string): number {
  return name.split("/").length - 1;
}

/** What the row calls it: the last part of the path, the rest being the rows above. */
function leafOf(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

/** Every deck above this one, nearest last: `a`, `a/b` for `a/b/c`. */
function ancestorsOf(name: string): string[] {
  const parts = name.split("/");
  return parts.slice(1).map((_, at) => parts.slice(0, at + 1).join("/"));
}

interface ReviewDecksProps {
  /** Start a sitting on this deck. */
  onPick: (deck: Deck) => void;
  /** Open the list of parked cards, which is `p` at a desk and this on a phone. */
  onParked: () => void;
  /** Whether to count decks filed in the archive. Off, the way search is off. */
  archive?: boolean;
}

/**
 * Every deck the vault holds, and how much of each is waiting.
 *
 * The scan says which notes are decks, and then each of those is read whole: a
 * vault of forty deck notes costs one `rg` pass and forty GETs. The counts are
 * worth that because they come off `parseCards`, the parser the sitting asks
 * from, so a deck can never promise a card its sitting will not ask.
 */
export function ReviewDecks({ onPick, onParked, archive = false }: ReviewDecksProps) {
  const [unfolded, setUnfolded] = useState(readUnfolded);

  function toggleFold(name: string) {
    const next = new Set(unfolded);
    if (!next.delete(name)) next.add(name);
    setUnfolded(next);
    writeUnfolded(next);
  }

  const { data: hits, isPending: scanning } = useQuery({
    queryKey: ["cards", archive],
    queryFn: () => fetchCards(archive),
    ...readRetry,
  });

  // Under `cards` rather than `note`, so the invalidation every rating, parking
  // and import already sends refetches these too, and the counts move with the
  // note the sitting just wrote rather than ten seconds later. One query per
  // note, so a note that fails to read costs its own cards and no one else's.
  const paths = hits === undefined ? [] : deckNotes(hits);
  const reads = useQueries({
    queries: paths.map((path) => ({
      queryKey: ["cards", "note", path],
      queryFn: () => fetchNote(path),
      ...readRetry,
    })),
  });

  // The same limits the sitting reads, so a row counts what its sitting asks.
  const limits = useReviewLimits();

  // Until the last note is in, so a vault of decks never flashes "No decks",
  // and until the limits are. Rows drawn before then count no limit; the
  // sitting waits for the limits itself, so what it asks never rests on that.
  // A retrying note still holds the summary: its cards are not in yet, so a
  // summary drawn without them would say "No decks" or count short.
  const isPending = scanning || reads.some((read) => read.isPending) || limits === undefined;

  const today = readClock(new Date()).date;
  const decks = decksFrom(
    paths.flatMap((path, at) => {
      const text = reads[at]?.data;
      return text === undefined ? [] : [{ path, text }];
    }),
    today,
    limits,
  );
  // Top-level rows only. A deck counts every card under it, so summing all of
  // them would count a card in `databases/postgres` again for `databases`, and
  // an imported Anki tree would read as twice the cards it holds.
  const top = decks.filter((deck) => depthOf(deck.name) === 0);
  const waiting = top.reduce((count, deck) => count + deck.due + deck.fresh, 0);
  const parked = top.reduce((count, deck) => count + deck.parked, 0);

  // A whole note is never a parent, even one whose name holds a slash: no
  // deck of cards sits under it, and folding it would hide nothing.
  const tagged = new Set(decks.filter((deck) => !deck.whole).map((deck) => deck.name));
  const parents = new Set([...tagged].flatMap(ancestorsOf).filter((name) => tagged.has(name)));
  // Gone rather than drawn hidden, so `j` in the pane walks only what shows.
  // A folded row still counts every card under it, as `decksFrom` counts it.
  const shown = decks.filter(
    (deck) =>
      deck.whole ||
      ancestorsOf(deck.name).every((above) => !parents.has(above) || unfolded.has(above)),
  );
  // The decks with cards to go are drawn first, then the ones with nothing due under
  // their own label. A subtree's counts are its top deck's, so the top deck decides
  // which group a row falls in, and the name order inside each group is kept.
  const topCards = new Map(top.map((deck) => [deck.name, deck.due + deck.fresh]));
  const hasCards = (deck: Deck) =>
    (topCards.get(deck.name.split("/", 1)[0] ?? deck.name) ?? deck.due + deck.fresh) > 0;
  const withCards = shown.filter(hasCards);
  const ordered = [...withCards, ...shown.filter((deck) => !hasCards(deck))];
  // A deck's row is keyed by its note when the deck is one whole note, and by its
  // name otherwise, which is what each is unique by. Nothing staggers in while the
  // notes are still arriving, so the first list to be complete is the one that does.
  const keyOf = (deck: Deck) => (deck.whole ? (deck.notes[0] ?? deck.name) : deck.name);
  const entering = useEntrance(isPending ? [] : shown.map(keyOf));

  // `Start with` begins the first row drawn with cards to go. Its parents hold
  // its count, so it is never folded away while it has cards.
  const first = shown.find((deck) => deck.due + deck.fresh > 0);
  const going = top.filter((deck) => deck.due + deck.fresh > 0).length;
  const parkedWords = parked > 0 ? ` ${parked} parked.` : "";
  const summary =
    waiting > 0
      ? `${waiting} ${waiting === 1 ? "card" : "cards"} to go today in ${going} ${going === 1 ? "deck" : "decks"}.${parkedWords}`
      : `Nothing to go today.${parkedWords}`;

  return (
    <div className="flex h-full flex-col bg-k-bg font-sans text-k-ink">
      <div className="min-h-0 flex-1 overflow-auto px-4 py-6">
        <div className="mx-auto w-full max-w-[var(--k-measure)]">
          <h2 className="font-serif text-k-27">Review</h2>
          {!isPending && <p className="mt-1 text-k-15 text-k-muted">{summary}</p>}
          {!isPending && first !== undefined && (
            <button
              type="button"
              data-start
              onClick={() => onPick(first)}
              className="mt-4 min-h-11 rounded bg-k-accent px-4 text-k-paper hover:opacity-90"
            >
              Start with {first.name}
            </button>
          )}

          {isPending && <p className="text-k-muted text-k-13">Reading the vault…</p>}

          {!isPending && decks.length === 0 && (
            <p className="text-k-muted text-k-13">
              No decks. A deck is a note tagged <span className="text-k-ink">#flashcards</span>, or{" "}
              <span className="text-k-ink">#flashcards/aws</span> to name it, holding lines written{" "}
              <span className="text-k-ink">front::back</span>.
            </p>
          )}

          {/* A whole note is keyed by its path and a deck of cards by its name,
            which is what each of the two is unique by: one tag is one deck
            however many notes carry it. */}
          <ul className="mt-6 space-y-2">
            {ordered.map((deck, index) => (
              <Fragment key={keyOf(deck)}>
                {index === withCards.length && withCards.length < ordered.length && (
                  <li role="presentation" className="pt-2 text-k-12 text-k-muted uppercase">
                    Nothing due
                  </li>
                )}
                <li
                  key={keyOf(deck)}
                  className={`flex items-center gap-1 ${entering(keyOf(deck)) ? "k-enter" : ""}`}
                  style={
                    entering(keyOf(deck)) ? ({ "--i": index } as React.CSSProperties) : undefined
                  }
                >
                  {/* Beside the row and not inside it: a button in a button is no
                  valid page, and a parent with nothing to offer is a disabled
                  row that still has to fold. */}
                  {!deck.whole && parents.has(deck.name) ? (
                    <button
                      type="button"
                      data-fold={deck.name}
                      aria-expanded={unfolded.has(deck.name)}
                      aria-label={`${unfolded.has(deck.name) ? "fold" : "unfold"} ${deck.name}`}
                      onClick={() => toggleFold(deck.name)}
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-k-muted hover:text-k-accent"
                    >
                      {unfolded.has(deck.name) ? "▾" : "▸"}
                    </button>
                  ) : (
                    // As wide as the toggle, so every name starts on one line. A
                    // list with no folds at all needs no gutter.
                    parents.size > 0 && <span aria-hidden="true" className="min-w-11 shrink-0" />
                  )}
                  <button
                    type="button"
                    onClick={() => onPick(deck)}
                    disabled={deck.due + deck.fresh === 0}
                    data-deck={deck.name}
                    // A deck under another is drawn indented and by its last part,
                    // the way the contents of a book are: `decksFrom` names every
                    // deck above one it finds, so the row it belongs under is
                    // always there and the full path would only repeat it.
                    style={{ paddingLeft: `${0.75 + depthOf(deck.name) * 0.75}rem` }}
                    className="k-row flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded border border-k-rule px-3 py-2 text-left hover:border-k-accent disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1 truncate text-k-15">
                      {depthOf(deck.name) > 0 && <span className="text-k-muted">/ </span>}
                      {leafOf(deck.name)}
                    </span>
                    {/* A deck with nothing to go shows no `0 due` and `0 new`: those
                    counts are what the name competes with on a narrow screen, and a
                    row with nothing to go says when it is next due instead. */}
                    {deck.due + deck.fresh > 0 && (
                      <>
                        <span
                          className={`shrink-0 text-k-13 ${deck.due > 0 ? "text-k-accent" : "text-k-muted"}`}
                        >
                          {deck.due} due
                        </span>
                        <span className="shrink-0 text-k-13 text-k-muted">{deck.fresh} new</span>
                      </>
                    )}
                    {/* Only where there are any. A deck of nothing but parked cards
                    lands disabled on the rule above, and a bare `0 new` would
                    leave no way to find out why. */}
                    {deck.parked > 0 && (
                      <span className="shrink-0 text-k-13 text-k-muted opacity-60">
                        {deck.parked} parked
                      </span>
                    )}
                    {/* Where a deck has nothing to go, when it is next due, so the
                    row says why it cannot be sat and when it can. */}
                    {deck.due + deck.fresh === 0 && (
                      <span className="shrink-0 text-k-13 text-k-muted">
                        {deck.next === null
                          ? "nothing scheduled"
                          : `due ${dayWords(deck.next, today)}`}
                      </span>
                    )}
                  </button>
                </li>
              </Fragment>
            ))}
          </ul>

          {/* Below the decks, since an import is rare beside a sitting and the
            decks are what a visit is for. */}
          <ReviewImport />

          {parked > 0 && (
            <button
              type="button"
              onClick={onParked}
              className="mt-6 min-h-11 text-k-13 text-k-link underline hover:text-k-accent"
            >
              {parked} parked {parked === 1 ? "card" : "cards"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
