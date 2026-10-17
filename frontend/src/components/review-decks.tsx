import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type AnkiImport, fetchCards, fetchNote, importAnki, importAnkiLink } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { type Deck, deckNotes, decksFrom } from "@/lib/review";

/** How far under another deck this one sits, `databases/postgres` being one. */
function depthOf(name: string): number {
  return name.split("/").length - 1;
}

/** What the row calls it: the last part of the path, the rest being the rows above. */
function leafOf(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
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
  const queryClient = useQueryClient();

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

  // Until the last note is in, so a vault of decks never flashes "No decks".
  const isPending = scanning || reads.some((read) => read.isPending);

  const today = readClock(new Date()).date;
  const decks = decksFrom(
    paths.flatMap((path, at) => {
      const text = reads[at]?.data;
      return text === undefined ? [] : [{ path, text }];
    }),
    today,
  );
  // Top-level rows only. A deck counts every card under it, so summing all of
  // them would count a card in `databases/postgres` again for `databases`, and
  // an imported Anki tree would read as twice the cards it holds.
  const top = decks.filter((deck) => depthOf(deck.name) === 0);
  const waiting = top.reduce((count, deck) => count + deck.due + deck.fresh, 0);
  const parked = top.reduce((count, deck) => count + deck.parked, 0);

  return (
    <div className="flex h-full flex-col bg-one-bg font-mono text-one-fg">
      <header className="flex items-center gap-3 border-one-line border-b px-3 py-2">
        <span className="text-[11px] text-one-muted uppercase tracking-wider">review</span>
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {decks.length} deck{decks.length === 1 ? "" : "s"}
        </span>
        <span className="text-[11px] text-one-muted uppercase tracking-wider">{waiting} to go</span>
        {/* A button and not only `p`, because `/review` is the phone's way in
            and a phone has no keyboard to press it on. */}
        {parked > 0 && (
          <button
            type="button"
            onClick={onParked}
            className="min-h-11 px-1 text-[11px] text-one-muted uppercase tracking-wider hover:text-one-accent"
          >
            {parked} parked
          </button>
        )}
      </header>

      <div className="border-one-line border-b px-3 text-[13px] text-one-muted">
        <div className="flex flex-wrap items-center gap-x-6">
          <label className="flex min-h-11 cursor-pointer items-center hover:text-one-accent">
            {/* A plain file input rather than a prompt of our own: the browser
                already has a file picker, and this one has to work on a phone. */}
            <input
              type="file"
              accept=".apkg"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // The value is cleared so picking the same file twice fires twice,
                // which is what a failed import wants to let you retry.
                event.target.value = "";
                if (file === undefined) return;
                void runImport(importAnki(file, carry));
              }}
            />
            <span>Import an Anki deck</span>
          </label>
          {/* Off by default: a re-import keeps the schedule kasten has been
              building unless you say Anki's is the one to trust. */}
          <label className="flex min-h-11 cursor-pointer items-center gap-2 hover:text-one-accent">
            <input
              type="checkbox"
              checked={carry}
              onChange={(event) => setCarry(event.target.checked)}
              className="size-4 accent-one-accent"
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
              className="my-1 min-h-11 min-w-0 flex-1 rounded border border-one-line bg-transparent px-2 text-one-fg outline-none placeholder:text-one-muted focus:border-one-accent"
            />
            <button
              type="submit"
              disabled={linking}
              className="min-h-11 px-1 hover:text-one-accent disabled:opacity-50"
            >
              Import link
            </button>
          </form>
        </div>
        {imported !== null && <p className="truncate pb-2 text-one-fg">{imported}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {isPending && <p className="text-one-muted text-[13px]">Reading the vault…</p>}

        {!isPending && decks.length === 0 && (
          <p className="text-one-muted text-[13px]">
            No decks. A deck is a note tagged <span className="text-one-fg">#flashcards</span>, or{" "}
            <span className="text-one-fg">#flashcards/aws</span> to name it, holding lines written{" "}
            <span className="text-one-fg">front::back</span>.
          </p>
        )}

        {/* A whole note is keyed by its path and a deck of cards by its name,
            which is what each of the two is unique by: one tag is one deck
            however many notes carry it. */}
        <ul className="space-y-2">
          {decks.map((deck) => (
            <li key={deck.whole ? deck.notes[0] : deck.name}>
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
                className="flex min-h-11 w-full items-center gap-3 rounded border border-one-line px-3 py-2 text-left hover:border-one-accent disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{leafOf(deck.name)}</span>
                <span className="text-[12px] text-one-accent">{deck.due} due</span>
                <span className="text-[12px] text-one-muted">{deck.fresh} new</span>
                {/* Only where there are any. A deck of nothing but parked cards
                    lands disabled on the rule above, and a bare `0 new` would
                    leave no way to find out why. */}
                {deck.parked > 0 && (
                  <span className="text-[12px] text-one-muted opacity-60">
                    {deck.parked} parked
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
