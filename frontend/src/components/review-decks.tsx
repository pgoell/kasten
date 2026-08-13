import { useQuery } from "@tanstack/react-query";
import { fetchCards } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { type Deck, decksFrom } from "@/lib/review";

interface ReviewDecksProps {
  /** Start a sitting on this deck. */
  onPick: (deck: Deck) => void;
  /** Whether to count decks filed in the archive. Off, the way search is off. */
  archive?: boolean;
}

/**
 * Every deck the vault holds, and how much of each is waiting.
 *
 * One fetch answers the whole screen, because the counts come off the scan's
 * lines rather than off the notes: a vault of forty decks costs one `rg` pass
 * and no note reads at all. The session opens the note it is about to ask, and
 * only then.
 */
export function ReviewDecks({ onPick, archive = false }: ReviewDecksProps) {
  const { data: hits, isPending } = useQuery({
    queryKey: ["cards", archive],
    queryFn: () => fetchCards(archive),
  });

  const today = readClock(new Date()).date;
  const decks = hits === undefined ? [] : decksFrom(hits, today);
  const waiting = decks.reduce((count, deck) => count + deck.due + deck.fresh, 0);

  return (
    <div className="flex h-full flex-col bg-one-bg font-mono text-one-fg">
      <header className="flex items-center gap-3 border-one-line border-b px-3 py-2">
        <span className="text-[11px] text-one-muted uppercase tracking-wider">review</span>
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {decks.length} deck{decks.length === 1 ? "" : "s"}
        </span>
        <span className="text-[11px] text-one-muted uppercase tracking-wider">{waiting} to go</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {isPending && <p className="text-one-muted text-[13px]">Reading the vault…</p>}

        {!isPending && decks.length === 0 && (
          <p className="text-one-muted text-[13px]">
            No decks. A deck is a note tagged <span className="text-one-fg">#flashcards</span>, or{" "}
            <span className="text-one-fg">#flashcards/aws</span> to name it, holding lines written{" "}
            <span className="text-one-fg">front::back</span>.
          </p>
        )}

        <ul className="space-y-2">
          {decks.map((deck) => (
            <li key={deck.note}>
              <button
                type="button"
                onClick={() => onPick(deck)}
                disabled={deck.due + deck.fresh === 0}
                data-deck={deck.name}
                className="flex min-h-11 w-full items-center gap-3 rounded border border-one-line px-3 py-2 text-left hover:border-one-accent disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{deck.name}</span>
                <span className="text-[12px] text-one-accent">{deck.due} due</span>
                <span className="text-[12px] text-one-muted">{deck.fresh} new</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
