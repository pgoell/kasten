import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NotePreview } from "@/components/note-preview";
import { fetchNote } from "@/lib/api";
import { soundsIn } from "@/lib/audio";
import { asTyped } from "@/lib/card-line";
import { readClock } from "@/lib/clock";
import { inDeck } from "@/lib/deck-tag";
import { noteBody } from "@/lib/note-frontmatter";
import { noteName } from "@/lib/note-path";
import type { Deck } from "@/lib/review";
import {
  appendStub,
  type Card,
  nextSchedule,
  parseCards,
  type Rating,
  readNoteSchedule,
  readNoteSuspended,
  sameAnswer,
  setSuspended,
  writeNoteSchedule,
  writeNoteSuspended,
  writeSchedule,
} from "@/lib/srs";
import { useSittingWrites } from "@/lib/use-sitting-writes";

/**
 * Where the typing toggle is kept, which is the browser and not the vault.
 *
 * It is a preference about how you like to be asked, not a fact about the
 * notes, so it has no business in a file. The archive toggle makes the opposite
 * call and is deliberately not persisted at all; the difference is that
 * forgetting the archive is safe and forgetting this one is a small annoyance
 * on every card.
 */
const TYPING_KEY = "kasten.review.typing";

/** The four ratings, in the order they are drawn and keyed. */
const RATINGS: { rating: Rating; label: string }[] = [
  { rating: "again", label: "Again" },
  { rating: "hard", label: "Hard" },
  { rating: "good", label: "Good" },
  { rating: "easy", label: "Easy" },
];

/**
 * A tap target big enough for a thumb.
 *
 * 44px is the smallest square Apple and Google both call reachable, and the
 * whole point of this screen is that it works on a phone. Every button here
 * carries it, including the ones a desktop would be happy to draw smaller.
 */
const BUTTON =
  "min-h-11 rounded border border-one-line px-4 py-2 text-[13px] text-one-fg " +
  "hover:border-one-accent hover:text-one-accent active:bg-one-panel";

interface ReviewSessionProps {
  deck: Deck;
  /** Leave the session, which is the back button and the pane's `q`. */
  onLeave: () => void;
  /**
   * Handed the callbacks a shell may want to put its own keys over.
   *
   * The pane binds `space` and `1` to `4` to these; the phone route binds
   * nothing, its buttons being the whole interface. Neither shell holds a rule
   * about scheduling, which is what keeps the two from drifting.
   */
  onControls?: (
    controls: {
      reveal: () => void;
      rate: (rating: Rating) => void;
      suspend: () => void;
      capture: () => void;
      replay: () => void;
    } | null,
  ) => void;
}

/**
 * Start a sound, letting a refusal go by in silence.
 *
 * A phone refuses a sound no tap asked for, which is the first card of every
 * sitting, and a sound whose source changed under it while it loaded rejects
 * as aborted. Neither is worth a word on the screen: the Replay button is
 * right there. A file that cannot play, deleted from the vault or in a format
 * the browser lacks, never ends, so `skip` moves on to the side's next sound
 * the way `ended` would. Those three are every way the spec lets `play()`
 * reject; anything else is a fault and goes on up.
 */
function start(player: HTMLAudioElement, skip: () => void): void {
  player.play().catch((error: unknown) => {
    if (!(error instanceof DOMException)) throw error;
    if (error.name === "NotSupportedError") skip();
    else if (error.name !== "NotAllowedError" && error.name !== "AbortError") throw error;
  });
}

/** One card in the sitting: which note holds it, and which of that note's cards. */
interface Seat {
  note: string;
  /** Its ordinal among the cards of that note, counting the ones other decks ask. */
  at: number;
}

/**
 * One deck, one card at a time.
 *
 * Every note the deck draws from is read once, at the start, and every rating
 * is written straight back to the note the card is in. That is a `PUT` per
 * answer, which is what the todo pane already does per press, and it means a
 * session interrupted halfway keeps the answers it got rather than losing them
 * the way a sitting of an exam does.
 *
 * The queue holds a note and an ordinal into its cards rather than the cards
 * themselves. Writing a schedule can insert a line, which moves every card
 * under it, but it can never add or remove a card, so card three stays card
 * three and the ordinals survive a rewrite that the line numbers do not.
 */
export function ReviewSession({ deck, onLeave, onControls }: ReviewSessionProps) {
  const [texts, setTexts] = useState<Map<string, string> | null>(null);
  const [queue, setQueue] = useState<Seat[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [typing, setTyping] = useState(() => localStorage.getItem(TYPING_KEY) === "on");
  /** What was typed for the card showing, kept so the verdict can quote it back. */
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(0);
  /** The question being jotted, or null while the capture line is closed. */
  const [jotting, setJotting] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // A failed write puts its message in the bar and the session carries on,
  // because a rating that vanished silently would be a card you answer again
  // tomorrow believing you had not.
  const write = useSittingWrites(setTexts, setFailed);

  const today = useMemo(() => readClock(new Date()).date, []);

  useEffect(() => {
    let live = true;
    // All of them before any of them is asked. A deck spanning three notes is
    // three reads at the start rather than one on the card that first needs it,
    // so the queue is the whole sitting from the first question and the count
    // in the header does not climb as you go.
    void Promise.all(deck.notes.map(async (note) => [note, await fetchNote(note)] as const)).then(
      (read) => {
        if (!live) return;
        const texts = new Map(read);
        setTexts(texts);
        // Due first, then the ones nobody has answered, each in its note's
        // order and the notes in the order the deck names them. Nothing is
        // shuffled: a deck written in an order was written in that order on
        // purpose, and an import arrives in the order Anki held.
        const seats = [...cardsOf(deck, texts)].flatMap(([note, cards]) =>
          cards.map((card, at) => ({ note, at, card })),
        );
        // A parked card keeps its seat and its ordinal and is never asked. It
        // has to keep them: the queue addresses a card by its ordinal, so a
        // card taken out of the array renumbers the ones behind it.
        const asked = seats.filter(({ card }) => card.parked === null);
        setQueue(
          [
            ...asked.filter(({ card }) => isDue(card, today)),
            ...asked.filter(({ card }) => card.held === null),
          ].map(({ note, at }) => ({ note, at })),
        );
      },
      (error: unknown) => {
        if (live) setFailed(error instanceof Error ? error.message : "could not read the note");
      },
    );
    return () => {
      live = false;
    };
  }, [deck, today]);

  const cards = useMemo(() => cardsOf(deck, texts ?? new Map()), [deck, texts]);
  const seat = queue[0];
  const card = seat === undefined ? undefined : cards.get(seat.note)?.[seat.at];
  // A whole note has nothing hidden to show, so it is shown from the start and
  // the four ratings are the only thing its footer ever draws.
  const shown = revealed || card?.back === "";
  const sounds = useMemo(
    () => (card === undefined ? [] : soundsShowing(card, revealed)),
    [card, revealed],
  );

  /**
   * The one player of the sitting, made on the first sound and kept.
   *
   * One element reused rather than one per card, and never the player the
   * preview draws: a phone lets an element play without a tap once a tap has
   * started it, which is what lets the second of two sounds follow the first.
   */
  const player = useRef<HTMLAudioElement | null>(null);
  /** The sounds of the side showing that wait behind the one playing. */
  const waiting = useRef<string[]>([]);
  /** The sound the player is on, or null once a side has run out or stopped. */
  const current = useRef<string | null>(null);
  /** Whether the card the deck read put on screen has been played. */
  const started = useRef(false);

  /**
   * Go on from the sound `from` to the next one waiting, on its end or failure.
   *
   * Only from the sound the player is still on: a missing file both rejects
   * its `play()` and fires `error`, and the second of those must not skip the
   * sound the first one moved on to.
   */
  const onward = useCallback((from: string | null) => {
    const made = player.current;
    if (made === null || from === null || from !== current.current) return;
    const next = waiting.current.shift() ?? null;
    current.current = next;
    if (next === null) return;
    made.src = next;
    start(made, () => onward(next));
  }, []);

  /**
   * Play a side's sounds in order, stopping whatever was playing.
   *
   * Called from inside the tap or key that turned the card wherever there is
   * one, because a phone refuses `play()` that does not start synchronously in
   * a gesture. An empty list is the stop.
   */
  const play = useCallback(
    (sources: string[]) => {
      // Cleared before the pause, so a sound ending under it plays nothing next.
      waiting.current = sources.slice(1);
      const first = sources[0] ?? null;
      current.current = first;
      player.current?.pause();
      if (first === null) return;
      if (player.current === null) {
        const made = document.createElement("audio");
        made.addEventListener("ended", () => onward(current.current));
        made.addEventListener("error", () => onward(current.current));
        player.current = made;
      }
      player.current.src = first;
      start(player.current, () => onward(first));
    },
    [onward],
  );

  // The first card is the one no tap shows: it lands when the deck read does.
  // A phone refuses it, silently, and Replay is the tap that plays it there.
  // Every card after it is played by the tap that rated or parked the last.
  useEffect(() => {
    if (card === undefined || started.current) return;
    started.current = true;
    play(soundsShowing(card, false));
  }, [card, play]);

  // Off with the sitting, so a sound never runs on over the deck list.
  useEffect(() => () => player.current?.pause(), []);

  const rate = useCallback(
    (rating: Rating) => {
      if (texts === null || seat === undefined) return;
      const text = texts.get(seat.note);
      const held = cards.get(seat.note)?.[seat.at];
      if (text === undefined || held === undefined) return;

      const moved = nextSchedule(held.held, rating, today);
      const next = deck.whole ? writeNoteSchedule(text, moved) : writeSchedule(text, held, moved);
      setTexts((was) => new Map(was).set(seat.note, next));
      setRevealed(false);
      setTyped("");
      setDone((count) => count + 1);
      // `again` sends the card to the back rather than out of the queue, which
      // is the one place the session disagrees with the schedule it just wrote:
      // the note says tomorrow, and today's sitting asks once more.
      setQueue((held_) => (rating === "again" ? [...held_.slice(1), seat] : held_.slice(1)));
      // The card the queue above puts up, played here because this is the tap.
      // `again` on the last card puts the same one up, and Anki asks it aloud.
      const coming = rating === "again" && queue.length === 1 ? seat : queue[1];
      const following = coming === undefined ? undefined : cards.get(coming.note)?.[coming.at];
      play(following === undefined ? [] : soundsShowing(following, false));

      write(seat.note, text, next);
    },
    [cards, deck, play, queue, seat, texts, today, write],
  );

  /**
   * Park the card on screen and move on, without rating it.
   *
   * The card leaves the queue and keeps its seat in the note, which is the
   * property the ordinals depend on: `setSuspended` splices a token and never
   * adds or removes a card, so every seat behind this one still addresses the
   * card it did before.
   */
  const suspend = useCallback(() => {
    if (texts === null || seat === undefined) return;
    const text = texts.get(seat.note);
    const held = cards.get(seat.note)?.[seat.at];
    if (text === undefined || held === undefined) return;

    // A whole note has no line to splice. Its synthetic card spans line 0, so
    // `setSuspended` would put the token under the opening `---` and break the
    // block, park nothing, and leave a line no screen can reach to undo.
    const next = deck.whole ? writeNoteSuspended(text, true) : setSuspended(text, held, true);
    setTexts((was) => new Map(was).set(seat.note, next));
    setRevealed(false);
    setTyped("");
    // The one token parks every number of a cloze, so the seats of the others
    // leave with this one rather than coming up parked later in the sitting.
    const after = cardsOf(deck, new Map([[seat.note, next]])).get(seat.note) ?? [];
    const left = queue
      .slice(1)
      .filter(({ note, at }) => note !== seat.note || after[at]?.parked === null);
    setQueue(left);
    const coming = left[0];
    const following = coming === undefined ? undefined : cards.get(coming.note)?.[coming.at];
    play(following === undefined ? [] : soundsShowing(following, false));

    write(seat.note, text, next);
  }, [cards, deck, play, queue, seat, texts, write]);

  /**
   * Write what was jotted at the end of the note the card on screen came from.
   *
   * The end, and never the middle: a card appended is last in line order, so
   * the ordinals the queue is holding all still address the cards they did.
   * Nothing about the sitting moves, which is the point of writing it here
   * rather than stopping to open the note.
   */
  function jot(question: string) {
    if (texts === null || seat === undefined) return;
    const text = texts.get(seat.note);
    if (text === undefined || question.trim() === "") return;

    const next = appendStub(text, question.trim());
    setTexts((was) => new Map(was).set(seat.note, next));
    setJotting(null);
    write(seat.note, text, next);
  }

  // A toggle, because the second press is the only way to shut the line
  // without writing a card: `Escape` is not bound here and a phone has none.
  const capture = useCallback(() => {
    setJotting((was) => (was === null ? "" : null));
  }, []);

  const jotOpen = jotting !== null;

  // The key opened the line, so the cursor belongs in it. An effect rather than
  // `autoFocus`, the way `clip-prompt.tsx:47` takes it, and the focus goes back
  // to the pane on the way out so the keys work again without a click.
  useEffect(() => {
    if (!jotOpen) return;
    const opener = document.activeElement;
    field.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [jotOpen]);

  const reveal = useCallback(() => {
    setRevealed(true);
    // Once, on the turn: a second space on an answer already showing is not a
    // request to hear it again, `r` and Replay being that.
    if (card !== undefined && !shown) play(soundsIn(card.back));
  }, [card, play, shown]);

  const replay = useCallback(() => play(sounds), [play, sounds]);

  const toggleTyping = useCallback(() => {
    setTyping((on) => {
      localStorage.setItem(TYPING_KEY, on ? "off" : "on");
      return !on;
    });
  }, []);

  useEffect(() => {
    onControls?.(card === undefined ? null : { reveal, rate, suspend, capture, replay });
    return () => onControls?.(null);
  }, [capture, card, onControls, rate, replay, reveal, suspend]);

  return (
    <div className="flex h-full flex-col bg-one-bg font-mono text-one-fg">
      {/* Seven things share this row, and at a phone's width the gaps between
          them are what the deck's name is squeezed out by. */}
      <header className="flex items-center gap-3 border-one-line border-b px-3 py-2 max-md:gap-1">
        <button
          type="button"
          onClick={onLeave}
          className="min-h-11 px-1 text-[13px] text-one-muted"
        >
          ← Decks
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px]">{deck.name}</span>
        <span className="text-[11px] text-one-muted uppercase tracking-wider">
          {queue.length} left
        </span>
        {/* The phone's `r`, and the only way to hear a first card a phone
            refused to play unasked. Drawn while the side showing has a sound. */}
        {sounds.length > 0 && (
          <button
            type="button"
            onClick={replay}
            className="min-h-11 px-2 text-[11px] text-one-muted uppercase tracking-wider hover:text-one-accent pointer-coarse:min-w-11"
          >
            Replay
          </button>
        )}
        {/* Beside Type and before the reveal, because a card you want out of
            the deck is one you have recognised from its question alone. */}
        {card !== undefined && (
          <button
            type="button"
            onClick={suspend}
            className="min-h-11 px-2 text-[11px] text-one-muted uppercase tracking-wider hover:text-one-accent"
          >
            Suspend
          </button>
        )}
        {card !== undefined && (
          <button
            type="button"
            onClick={capture}
            aria-expanded={jotOpen}
            // Three letters are narrower than a thumb, which the height alone
            // does not make up for.
            className="min-h-11 px-2 text-[11px] text-one-muted uppercase tracking-wider hover:text-one-accent pointer-coarse:min-w-11"
          >
            Jot
          </button>
        )}
        <button
          type="button"
          onClick={toggleTyping}
          aria-pressed={typing}
          className={`min-h-11 px-2 text-[11px] uppercase tracking-wider pointer-coarse:min-w-11 ${
            typing ? "text-one-accent" : "text-one-muted"
          }`}
        >
          Type
        </button>
      </header>

      {/* Under the header rather than in the footer, which is the reveal's and
          the ratings'. A question you thought of belongs beside the card that
          prompted it, and the card stays on screen while you write it. */}
      {jotting !== null && (
        <form
          data-testid="review-capture"
          onSubmit={(event) => {
            event.preventDefault();
            jot(jotting);
          }}
          className="flex gap-2 border-one-line border-b px-3 py-2"
        >
          <input
            // Off, both of them, for the reason the typing field has them off:
            // a question is as often a term of art as a sentence.
            autoCapitalize="off"
            autoCorrect="off"
            ref={field}
            aria-label="a new question"
            value={jotting}
            onChange={(event) => setJotting(event.target.value)}
            placeholder="A question to answer later"
            className="min-h-11 min-w-0 flex-1 rounded border border-one-line bg-transparent px-3 text-[13px] text-one-fg outline-none focus:border-one-accent pointer-coarse:text-base"
          />
          <button type="submit" className={BUTTON}>
            Jot it
          </button>
        </form>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-4 py-6 text-[15px]">
        {texts === null && failed === null && <p className="text-one-muted">Reading the deck…</p>}

        {card === undefined && texts !== null && (
          <div data-testid="review-done">
            <p>Nothing left in {deck.name}.</p>
            <p className="mt-2 text-one-muted">{done} answered.</p>
          </div>
        )}

        {card !== undefined && (
          <div data-testid="review-card">
            {/* Rendered the way the editor renders it, so a card holding a
                table is asked as a table and not as a row of pipes. Keyed on
                the text because the preview reads it once, on mount. */}
            <NotePreview key={`front:${card.front}`} text={card.front} />
            {shown && typing && (
              <p data-testid="review-verdict" className="mt-6 text-[13px] text-one-muted">
                {/* A cloze's back is the whole line, its target the hidden text.
                    A basic back is markdown, its escapes no part of the answer. */}
                {sameAnswer(typed, card.target ?? asTyped(card.back)) ? (
                  "Matched"
                ) : (
                  <>
                    You typed <span className="text-one-fg">{typed || "nothing"}</span>
                  </>
                )}
              </p>
            )}
            {shown && (
              <div
                data-testid="review-back"
                className="review-back mt-6 border-one-line border-t pt-6"
              >
                <NotePreview key={`back:${card.back}`} text={card.back} />
              </div>
            )}
          </div>
        )}

        {failed !== null && (
          <p role="alert" className="mt-6 text-one-muted">
            The note could not be written: {failed}
          </p>
        )}
      </div>

      {card !== undefined && (
        <footer className="border-one-line border-t p-3">
          {shown ? (
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map(({ rating, label }) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => rate(rating)}
                  className={BUTTON}
                  data-rating={rating}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : typing ? (
            <form
              data-testid="review-typed"
              onSubmit={(event) => {
                event.preventDefault();
                reveal();
              }}
              className="flex gap-2"
            >
              <input
                // Off, both of them: an answer is a term of art as often as it
                // is a sentence, and a phone that capitalises and corrects it
                // marks you wrong for something you did not type.
                autoCapitalize="off"
                autoCorrect="off"
                aria-label="your answer"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                className="min-h-11 min-w-0 flex-1 rounded border border-one-line bg-transparent px-3 text-[15px] text-one-fg outline-none focus:border-one-accent pointer-coarse:text-base"
              />
              {/* Submitting the form is what the phone keyboard's Go key does. */}
              <button type="submit" className={BUTTON}>
                Check
              </button>
            </form>
          ) : (
            <button type="button" onClick={reveal} className={`${BUTTON} w-full`}>
              Show answer
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

/**
 * The sounds of the side of a card on screen, its back once that is turned.
 *
 * A whole note keeps its sounds in the front, its back being empty, so it is
 * the front that plays however the reveal was pressed.
 */
function soundsShowing(card: Card, revealed: boolean): string[] {
  return soundsIn(revealed && card.back !== "" ? card.back : card.front);
}

/** Whether the card is one today's sitting should ask. */
function isDue(card: Card, today: string): boolean {
  return card.held !== null && card.held.due <= today;
}

/**
 * What this deck asks out of each note, which is either its cards or itself.
 *
 * The one place the two kinds part company. A `#review` note becomes a single
 * card whose front is the note and whose back is nothing, so the queue, the
 * rating and the writing downstream are the same code for both, and only the
 * lines here know there was ever a difference.
 *
 * A note's cards are filtered to this deck's, because a note holding two decks
 * is the whole point of a card carrying a tag of its own: sitting `dbt` asks
 * the one card in the stored procedures note that says it is about dbt, and
 * none of the others.
 */
function cardsOf(deck: Deck, texts: Map<string, string>): Map<string, Card[]> {
  return new Map(
    [...texts].map(([note, text]) => {
      if (deck.whole) {
        const held = readNoteSchedule(text);
        const whole = {
          from: 0,
          to: 0,
          front: noteBody(text).trim(),
          back: "",
          inline: false,
          cloze: null,
          target: null,
        };
        return [
          note,
          [
            {
              ...whole,
              decks: [deck.name],
              held,
              parked: readNoteSuspended(text) ? "suspended" : null,
            },
          ],
        ];
      }
      // A deck below this one is part of it, so a sitting of `databases` asks
      // the cards filed under `databases/postgres` as well.
      const cards = parseCards(text, noteName(note)).filter((card) =>
        card.decks.some((filed) => inDeck(filed, deck.name)),
      );
      return [note, cards];
    }),
  );
}
