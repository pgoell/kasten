import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NotePreview } from "@/components/note-preview";
import { BUTTON, ReviewAnswer, ReviewSource } from "@/components/review-answer";
import { SwipeCard } from "@/components/review-swipe";
import { shiftDay } from "@/lib/clock";
import { noteName } from "@/lib/note-path";
import { unescaped } from "@/lib/review/card-line";
import { sameAnswer } from "@/lib/review/card-text";
import type { Deck } from "@/lib/review/review";
import { daysBetween, dayWords } from "@/lib/review/review-days";
import type { Card, Rating } from "@/lib/review/srs";
import { soundsShowing, useCardSounds } from "@/lib/review/use-card-sounds";
import { useReviewSitting } from "@/lib/review/use-review-sitting";

/**
 * The typing toggle is kept in the browser, not the vault: it is a preference, not a fact about the notes.
 */
const TYPING_KEY = "kasten.review.typing";

/** Where the Center toggle is kept, for the reason the typing toggle is. */
const CENTER_KEY = "kasten.review.center";

interface ReviewSessionProps {
  deck: Deck;
  /** Leave the session, which is the back button and the pane's `q`. */
  onLeave: () => void;
  /**
   * Callbacks a shell may bind its own keys over. The phone route binds none.
   */
  onControls?: (
    controls: {
      /** Whether a card is on screen, which the done screen holding Undo has not. */
      showing: boolean;
      /** Whether the answer is up, which is what makes Enter grade Good rather than reveal. */
      shown: boolean;
      /**
       * Whether the answer was turned over on a card that has one. A whole note is
       * shown from the start, and an undo turns its answer back on, so neither
       * counts: an Enter must not grade a note nobody has turned over.
       */
      revealed: boolean;
      reveal: () => void;
      rate: (rating: Rating) => void;
      suspend: () => void;
      capture: () => void;
      replay: () => void;
      undo: () => void;
    } | null,
  ) => void;
  /**
   * Opens the card's source: the note, at the card's line, or the top of a whole note.
   *
   * The pane opens it beside the review and the phone route leaves for the page,
   * so the two shells say where it goes and this says only what to open.
   */
  onOpen?: (path: string, line?: number) => void;
}

/**
 * One deck, one card at a time. The sitting's state is in `useReviewSitting`; this holds the rest.
 */
export function ReviewSession({ deck, onLeave, onControls, onOpen }: ReviewSessionProps) {
  const [typing, setTyping] = useState(() => localStorage.getItem(TYPING_KEY) === "on");
  /** The question being jotted, or null while the capture line is closed. */
  const [jotting, setJotting] = useState<string | null>(null);
  /** The note the open capture line writes into. */
  const [jotNote, setJotNote] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const [center, setCenter] = useState(() => localStorage.getItem(CENTER_KEY) === "on");
  const { play, playFirst } = useCardSounds();
  // A swiped card in flight: the ref refuses presses at once, and the state greys
  // the grade buttons while the flight is out, the way an undo does.
  const flying = useRef(false);
  const [landing, setLanding] = useState(false);
  const onFlight = useCallback((on: boolean) => {
    flying.current = on;
    setLanding(on);
  }, []);
  const {
    texts,
    queue,
    seat,
    card,
    revealed,
    shown,
    next,
    nextDue,
    doneToday,
    newCount,
    today,
    typed,
    setTyped,
    done,
    failed,
    rereadable,
    reread,
    step,
    undoing,
    reveal,
    rate,
    suspend,
    undo,
    jot: writeJot,
  } = useReviewSitting(deck, play, flying);

  const daysAgo = daysAgoOf(card, today);

  // The card the sitting opens on is already there when the page is, so it does
  // not come in. Every card after it does, once, when its remount plays the entrance.
  const opening = useRef<number | null>(null);
  if (card !== undefined && opening.current === null) opening.current = done;
  const entering = card !== undefined && opening.current !== done;

  const sounds = useMemo(
    () => (card === undefined ? [] : soundsShowing(card, revealed)),
    [card, revealed],
  );

  // The first card is the one no tap shows, played once it lands.
  useEffect(() => {
    playFirst(card);
  }, [card, playFirst]);

  /**
   * Write what was jotted at the end of the note the capture line opened on,
   * and close the line once it is written.
   */
  function jot(question: string) {
    if (jotNote === null) return;
    if (writeJot(jotNote, question)) setJotting(null);
  }

  // A toggle, because the second press is the only way to shut the line
  // without writing a card: `Escape` is not bound here and a phone has none.
  // Nothing on the done screen, where the controls stay up for Undo alone and a
  // jot would have no note to go into, nor while an undo is out.
  const capture = useCallback(() => {
    if (seat === undefined || card === undefined || undoing || flying.current) return;
    if (jotting !== null) {
      setJotting(null);
      return;
    }
    setJotting("");
    // The note the line was opened on, which an undo landing under a held
    // question can take off the screen.
    setJotNote(seat.note);
  }, [card, jotting, seat, undoing]);

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

  const replay = useCallback(() => play(sounds), [play, sounds]);

  const toggleTyping = useCallback(() => {
    setTyping((on) => {
      localStorage.setItem(TYPING_KEY, on ? "off" : "on");
      return !on;
    });
  }, []);

  const toggleCenter = useCallback(() => {
    setCenter((on) => {
      localStorage.setItem(CENTER_KEY, on ? "off" : "on");
      return !on;
    });
  }, []);

  // Held on the done screen too while a step is, so `u` can bring back the
  // last card of the deck. `showing` tells the pane there is no card there, so
  // its `space` is the leader again rather than a reveal of nothing.
  // A layout effect so a key pressed the moment the card shows reaches it: a
  // passive effect ran a tick later and left a window where the key graded nothing (#927).
  useLayoutEffect(() => {
    const showing = card !== undefined;
    const turned = card !== undefined && revealed && card.back !== "";
    onControls?.(
      !showing && step === null
        ? null
        : { showing, shown, revealed: turned, reveal, rate, suspend, capture, replay, undo },
    );
    return () => onControls?.(null);
  }, [capture, card, onControls, rate, replay, reveal, revealed, shown, step, suspend, undo]);

  return (
    <div className="flex h-full flex-col bg-k-bg font-sans text-k-ink">
      {/* Nine things share this row, and at a phone's width the gaps between
          them are what the deck's name is squeezed out by. A card with a sound
          puts Replay beside Undo, which is more than a phone holds, so there
          the row wraps rather than pushing Center off the screen. */}
      <SessionHeader
        name={deck.name}
        left={queue.length}
        onLeave={onLeave}
        sounds={sounds.length > 0}
        onReplay={replay}
        undoable={step !== null || undoing}
        undoing={undoing}
        onUndo={undo}
        typing={typing}
        onTyping={toggleTyping}
        center={center}
        onCenter={toggleCenter}
      />

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
          className="flex gap-2 border-k-rule border-b px-3 py-2"
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
            className="min-h-11 min-w-0 flex-1 rounded border border-k-rule bg-transparent px-3 text-k-13 text-k-ink outline-none focus:border-k-accent pointer-coarse:text-base"
          />
          {/* Disabled while an undo is out, the question kept in the field
              for the next submit. */}
          <button type="submit" disabled={undoing} className={BUTTON}>
            Jot it
          </button>
        </form>
      )}

      {/* Centred by the card's own auto margins and never by `justify-center`
          here: a card taller than the pane would be pushed past the top of the
          scroll, where nothing can reach it. */}
      <div
        className={`min-h-0 flex-1 overflow-auto px-4 py-6 text-k-15 ${center ? "flex flex-col" : ""}`}
      >
        {texts === null && failed === null && <p className="text-k-muted">Reading the deck…</p>}

        {card === undefined && texts !== null && (
          <DoneScreen
            name={deck.name}
            doneToday={doneToday}
            nextDue={nextDue}
            newCount={newCount}
            today={today}
          />
        )}

        {card !== undefined && (
          <SwipeCard
            swipe={shown && !undoing}
            onGrade={rate}
            onFlight={onFlight}
            onTap={shown ? undefined : reveal}
            className={`mx-auto w-full max-w-[var(--k-measure)]${center ? " review-center my-auto text-center" : ""} pointer-coarse:rounded-[var(--k-radius-8)] pointer-coarse:border pointer-coarse:border-k-rule pointer-coarse:bg-k-paper pointer-coarse:px-4 pointer-coarse:pt-10 pointer-coarse:pb-4`}
          >
            <div key={done} data-testid="review-card" className={entering ? "k-enter" : undefined}>
              <CardFace
                card={card}
                shown={shown}
                typing={typing}
                typed={typed}
                note={seat?.note}
                whole={deck.whole}
                daysAgo={daysAgo}
                onOpen={onOpen}
              />
            </div>
          </SwipeCard>
        )}

        <ReadFailure failed={failed} rereadable={rereadable} onReread={reread} />
      </div>

      {card !== undefined && (
        <ReviewAnswer
          shown={shown}
          typing={typing}
          typed={typed}
          onTyped={setTyped}
          undoing={undoing || landing}
          jotOpen={jotOpen}
          next={next}
          onReveal={reveal}
          onRate={rate}
          onPark={suspend}
          onCapture={capture}
        />
      )}
    </div>
  );
}

/**
 * How long ago the card was last answered: its due day less its interval is the
 * day it was answered, which the rating wrote. Null for a card nobody has answered.
 */
function daysAgoOf(card: Card | undefined, today: string): number | null {
  if (card === undefined || card.held === null) return null;
  const since = daysBetween(shiftDay(card.held.due, -card.held.interval), today);
  // A day count that reads backwards is a schedule nobody could have answered on,
  // so the clause is dropped rather than printed as a negative.
  return since < 0 ? null : since;
}

interface SessionHeaderProps {
  name: string;
  /** How many cards the queue holds. */
  left: number;
  onLeave: () => void;
  /** Whether the side showing has a sound. */
  sounds: boolean;
  onReplay: () => void;
  /** Whether there is a step to take back, or one going back now. */
  undoable: boolean;
  undoing: boolean;
  onUndo: () => void;
  typing: boolean;
  onTyping: () => void;
  center: boolean;
  onCenter: () => void;
}

function SessionHeader({
  name,
  left,
  onLeave,
  sounds,
  onReplay,
  undoable,
  undoing,
  onUndo,
  typing,
  onTyping,
  center,
  onCenter,
}: SessionHeaderProps) {
  return (
    <header className="flex items-center gap-3 border-k-rule border-b px-3 py-2 max-md:flex-wrap max-md:justify-end max-md:gap-1">
      <button
        type="button"
        onClick={onLeave}
        className="min-h-11 px-2 max-md:px-1 text-k-13 text-k-muted"
      >
        ← Decks
      </button>
      <span className="min-w-0 flex-1 truncate font-mono text-k-13 text-k-muted">{name}</span>
      <span className="px-2 max-md:px-1 text-k-12 text-k-muted uppercase tracking-k-label">
        {left} left
      </span>
      {/* The phone's `r`, and the only way to hear a first card a phone
          refused to play unasked. Drawn while the side showing has a sound. */}
      {sounds && (
        <button
          type="button"
          onClick={onReplay}
          className="min-h-11 px-2 max-md:px-1 text-k-12 text-k-muted uppercase tracking-k-label hover:text-k-accent pointer-coarse:min-w-11"
        >
          Replay
        </button>
      )}
      {/* Drawn while there is a step to take back, the done screen included,
          and greyed while the undo is out so a second tap sends nothing.
          `aria-disabled` and not `disabled` here and on Park, Write a new
          question and Show the answer: the browser blurs a focused button it disables, which
          takes the focus out of the pane and its keys with it. The callbacks
          refuse while the undo is out. */}
      {undoable && (
        <button
          type="button"
          onClick={onUndo}
          aria-disabled={undoing}
          className="min-h-11 px-2 max-md:px-1 text-k-12 text-k-muted uppercase tracking-k-label hover:text-k-accent aria-disabled:opacity-50 pointer-coarse:min-w-11"
        >
          Undo
        </button>
      )}
      <button
        type="button"
        onClick={onTyping}
        aria-pressed={typing}
        className={`min-h-11 px-2 max-md:px-1 text-k-12 uppercase tracking-k-label pointer-coarse:min-w-11 ${
          typing ? "text-k-accent" : "text-k-muted"
        }`}
      >
        Type
      </button>
      <button
        type="button"
        onClick={onCenter}
        aria-pressed={center}
        className={`min-h-11 px-2 max-md:px-1 text-k-12 uppercase tracking-k-label ${
          center ? "text-k-accent" : "text-k-muted"
        }`}
      >
        Center
      </button>
    </header>
  );
}

interface DoneScreenProps {
  name: string;
  doneToday: number;
  nextDue: string | null;
  /** New cards held back for a limit. */
  newCount: number;
  today: string;
}

function DoneScreen({ name, doneToday, nextDue, newCount, today }: DoneScreenProps) {
  return (
    <div data-testid="review-done" className="mx-auto w-full max-w-[var(--k-measure)]">
      <h2 className="font-serif text-k-27">Done for today</h2>
      <p className="mt-4 text-k-muted">
        {doneToday} answered today in {name}.
      </p>
      <p className="mt-2 text-k-muted">
        {nextDue !== null
          ? `The next cards are due ${dayWords(nextDue, today)}.`
          : `Nothing in ${name} is scheduled yet.`}
      </p>
      {/* New cards held back for a limit, which the schedule above does not name. */}
      {newCount > 0 && (
        <p className="mt-2 text-k-muted">
          {newCount} new {newCount === 1 ? "card waits" : "cards wait"}.
        </p>
      )}
    </div>
  );
}

interface CardFaceProps {
  card: Card;
  shown: boolean;
  typing: boolean;
  typed: string;
  /** The note the card sits in. */
  note: string | undefined;
  whole: boolean;
  daysAgo: number | null;
  onOpen?: (path: string, line?: number) => void;
}

/** The question, and once shown, the verdict on what was typed, the answer and its source. */
function CardFace({ card, shown, typing, typed, note, whole, daysAgo, onOpen }: CardFaceProps) {
  return (
    <>
      {/* Rendered the way the editor renders it, so a card holding a
      table is asked as a table and not as a row of pipes. Keyed on
      the text because the preview reads it once, on mount. */}
      {/* A phone reads the question as a title, so only the question is
      set at 28 px. The answer and the lines around the card keep
      the body size. */}
      <div
        data-testid="review-question"
        className="review-front font-serif text-k-27 max-md:text-[28px] max-md:leading-[1.15] max-md:tracking-[var(--k-track-title)]"
      >
        <NotePreview key={`front:${card.front}`} text={card.front} gaps={card.cloze !== null} />
      </div>
      {shown && typing && (
        <p data-testid="review-verdict" className="mt-6 text-k-13 text-k-muted">
          {/* A cloze's back is the whole line, its target the hidden text.
          A basic back is markdown, its escapes no part of the answer. */}
          {sameAnswer(typed, card.target ?? unescaped(card.back)) ? (
            "Matched"
          ) : (
            <>
              You typed <span className="text-k-ink">{typed || "nothing"}</span>
            </>
          )}
        </p>
      )}
      {shown && (
        <div data-testid="review-back" className="review-back mt-6 border-k-rule border-t pt-6">
          <NotePreview key={`back:${card.back}`} text={card.back} />
        </div>
      )}
      {shown && note !== undefined && (
        <ReviewSource
          name={noteName(note)}
          line={whole ? undefined : card.from + 1}
          daysAgo={daysAgo}
          onOpen={() => (whole ? onOpen?.(note) : onOpen?.(note, card.from + 1))}
        />
      )}
    </>
  );
}

/** Why the deck could not be read, and the button that reads it again. */
function ReadFailure({
  failed,
  rereadable,
  onReread,
}: {
  failed: string | null;
  rereadable: boolean;
  onReread: () => void;
}) {
  return (
    <>
      {failed !== null && (
        <p role="alert" className="mt-6 text-k-muted">
          {failed}
        </p>
      )}
      {rereadable && (
        // The reread unmounts this button, and a focus on it would fall to the
        // body and take the pane's keys with it, so the focus goes to the pane first.
        <button
          type="button"
          data-reread
          onClick={(event) => {
            event.currentTarget.closest<HTMLElement>("[tabindex]")?.focus();
            onReread();
          }}
          className={`mt-3 ${BUTTON}`}
        >
          Try again
        </button>
      )}
    </>
  );
}
