import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { type AnkiImport, fetchCards, fetchNote, importAnki, importAnkiLink } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { whenKeysUp } from "@/lib/last-input";
import { type Deck, deckNotes, decksFrom } from "@/lib/review";
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

/** The line under the import row, one for a file and a link alike. */
function summaryOf(done: AnkiImport): string {
  return (
    `${done.notes.length} deck${done.notes.length === 1 ? "" : "s"}, ${done.cards} cards: ` +
    `${done.added} added, ${done.updated} updated, ${done.kept} kept, ` +
    `${done.removed} removed in Anki` +
    (done.media > 0 ? `, ${done.media} media file${done.media === 1 ? "" : "s"}` : "")
  );
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
  const [imported, setImported] = useState<string | null>(null);
  const [carry, setCarry] = useState(false);
  const [link, setLink] = useState("");
  const [linking, setLinking] = useState(false);
  const [unfolded, setUnfolded] = useState(readUnfolded);
  const picker = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  function toggleFold(name: string) {
    const next = new Set(unfolded);
    if (!next.delete(name)) next.add(name);
    setUnfolded(next);
    writeUnfolded(next);
  }

  /** Run one import, from a file or a link, and say on the line how it went. */
  function runImport(started: Promise<AnkiImport>): Promise<boolean> {
    setImported("Importing…");
    return started.then(
      (done) => {
        setImported(summaryOf(done));
        void queryClient.invalidateQueries({ queryKey: ["cards"] });
        void queryClient.invalidateQueries({ queryKey: ["files"] });
        return true;
      },
      (error: unknown) => {
        setImported(error instanceof Error ? error.message : "the import failed");
        return false;
      },
    );
  }

  const { data: hits, isPending: scanning } = useQuery({
    queryKey: ["cards", archive],
    queryFn: () => fetchCards(archive),
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
    })),
  });

  // The same limits the sitting reads, so a row counts what its sitting asks.
  const limits = useReviewLimits();

  // Until the last note is in, so a vault of decks never flashes "No decks",
  // and until the limits are. Rows drawn before then count no limit; the
  // sitting waits for the limits itself, so what it asks never rests on that.
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
  // A deck's row is keyed by its note when the deck is one whole note, and by its
  // name otherwise, which is what each is unique by. Nothing staggers in while the
  // notes are still arriving, so the first list to be complete is the one that does.
  const keyOf = (deck: Deck) => (deck.whole ? (deck.notes[0] ?? deck.name) : deck.name);
  const entering = useEntrance(isPending ? [] : shown.map(keyOf));

  return (
    <div className="flex h-full flex-col bg-k-bg font-mono text-k-ink">
      <header className="flex items-center gap-3 border-k-rule border-b px-3 py-2">
        <span className="text-[11px] text-k-muted uppercase tracking-wider">review</span>
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {decks.length} deck{decks.length === 1 ? "" : "s"}
        </span>
        <span className="text-[11px] text-k-muted uppercase tracking-wider">{waiting} to go</span>
        {/* A button and not only `p`, because `/review` is the phone's way in
            and a phone has no keyboard to press it on. */}
        {parked > 0 && (
          <button
            type="button"
            onClick={onParked}
            className="min-h-11 px-1 text-[11px] text-k-muted uppercase tracking-wider hover:text-k-accent"
          >
            {parked} parked
          </button>
        )}
      </header>

      {/* Closed until asked for, since an import is rare beside a sitting.
          `details` hides what it holds rather than unmounting it, so closing
          it keeps the summary line, the tick and a half-typed link. */}
      <details className="border-k-rule border-b px-3 text-[13px] text-k-muted">
        {/* Not `flex`: the browser draws the open and closed triangle only on
            a summary left as a list item, and that triangle is what says this
            line opens. */}
        <summary className="min-h-11 cursor-pointer content-center hover:text-k-accent">
          Import
        </summary>
        <div className="flex flex-wrap items-center gap-x-6">
          {/* A plain file input rather than a prompt of our own: the browser
              already has a file picker, and this one has to work on a phone.
              Hidden, because a file input draws as grey text that reads as no
              control, and the button below presses it. */}
          <input
            ref={picker}
            type="file"
            accept=".apkg"
            aria-label="Import an Anki deck"
            tabIndex={-1}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // The value is cleared so picking the same file twice fires twice,
              // which is what a failed import wants to let you retry.
              event.target.value = "";
              if (file === undefined) return;
              // Floored, so the line never reads 100% while a piece is still
              // on its way; once all are in, the backend is what is busy.
              void runImport(
                importAnki(file, carry, (sent, total) =>
                  setImported(
                    sent === total
                      ? "Importing…"
                      : `Uploading ${Math.floor((100 * sent) / total)}%…`,
                  ),
                ),
              );
            }}
          />
          <button
            type="button"
            onClick={() => whenKeysUp(() => picker.current?.click())}
            className="my-1 min-h-11 rounded border border-k-rule px-3 text-k-ink hover:border-k-accent hover:text-k-accent"
          >
            Import an Anki deck
          </button>
          {/* Off by default: a re-import keeps the schedule kasten has been
              building unless you say Anki's is the one to trust. */}
          <label className="flex min-h-11 cursor-pointer items-center gap-2 hover:text-k-accent">
            <input
              type="checkbox"
              checked={carry}
              onChange={(event) => setCarry(event.target.checked)}
              className="size-4 accent-k-accent"
            />
            <span>Carry Anki's schedule</span>
          </label>
          {/* A form so Enter at a desk and Go on a phone keyboard both submit.
              The field keeps a link that failed, to retry, and clears on one
              that landed. */}
          {/* `noValidate`, or the browser refuses a link it thinks is no URL
              with its own bubble and the backend's sentence never shows. */}
          <form
            noValidate
            className="flex min-w-0 flex-1 basis-64 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const url = link.trim();
              // `linking` and not only the disabled button: Enter in the field
              // submits the form whatever state the button is in.
              if (url === "" || linking) return;
              setLinking(true);
              void runImport(importAnkiLink(url, carry)).then((landed) => {
                setLinking(false);
                if (landed) setLink("");
              });
            }}
          >
            <input
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="a link to an Anki deck"
              placeholder="or paste a link to a deck"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              className="my-1 min-h-11 min-w-0 flex-1 rounded border border-k-rule bg-transparent px-2 text-k-ink outline-none placeholder:text-k-muted focus:border-k-accent"
            />
            <button
              type="submit"
              disabled={linking}
              className="min-h-11 px-1 hover:text-k-accent disabled:opacity-50"
            >
              Import link
            </button>
          </form>
        </div>
        {imported !== null && <p className="truncate pb-2 text-k-ink">{imported}</p>}
      </details>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {isPending && <p className="text-k-muted text-[13px]">Reading the vault…</p>}

        {!isPending && decks.length === 0 && (
          <p className="text-k-muted text-[13px]">
            No decks. A deck is a note tagged <span className="text-k-ink">#flashcards</span>, or{" "}
            <span className="text-k-ink">#flashcards/aws</span> to name it, holding lines written{" "}
            <span className="text-k-ink">front::back</span>.
          </p>
        )}

        {/* A whole note is keyed by its path and a deck of cards by its name,
            which is what each of the two is unique by: one tag is one deck
            however many notes carry it. */}
        <ul className="space-y-2">
          {shown.map((deck, index) => (
            <li
              key={keyOf(deck)}
              className={`flex items-center gap-1 ${entering(keyOf(deck)) ? "k-enter" : ""}`}
              style={entering(keyOf(deck)) ? ({ "--i": index } as React.CSSProperties) : undefined}
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
                <span className="min-w-0 flex-1 truncate text-[13px]">{leafOf(deck.name)}</span>
                <span className="text-[12px] text-k-accent">{deck.due} due</span>
                <span className="text-[12px] text-k-muted">{deck.fresh} new</span>
                {/* Only where there are any. A deck of nothing but parked cards
                    lands disabled on the rule above, and a bare `0 new` would
                    leave no way to find out why. */}
                {deck.parked > 0 && (
                  <span className="text-[12px] text-k-muted opacity-60">{deck.parked} parked</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
