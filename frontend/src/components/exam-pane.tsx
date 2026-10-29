import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExamQuestion, ExamScore } from "@/components/exam-sheet";
import { createNote, fetchNote } from "@/lib/api";
import { readClock } from "@/lib/clock";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import { LABEL, STATUS } from "@/lib/overlay-styles";
import {
  type Answers,
  type Exam,
  gradeExam,
  LETTERS,
  parseExam,
  type Question,
  resultNote,
  resultPath,
} from "@/lib/review/exam";
import { LENGTHS, useExamTimer } from "@/lib/review/use-exam-timer";
import { beginLeader, paneOpener } from "@/lib/which-key";

/** One button of the touch row: a thumb high, and as wide as its share of the row. */
const TAP = "min-h-11 min-w-0 flex-1 uppercase";

interface ExamPaneProps {
  /** The note holding the exam. The pane reads it and never writes to it. */
  note: string;
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Open a note in this pane, which is how the result note is reached. */
  onOpen: (path: string) => void;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
}

/**
 * Taking one of the vault's practice exams, one question at a time.
 *
 * The note is the source of truth and this never writes to it. What a sitting
 * leaves behind is a separate note beside the exam, so the same exam can be sat
 * again tomorrow and the two results sit next to each other.
 *
 * Answers live in React state until the sitting is graded, so a reload loses a
 * sitting in progress. That is the deliberate simplification: writing every
 * press to disk would be a note rewritten sixty times per exam to buy a resume
 * nobody has yet wanted.
 *
 * ponytail: no shuffle. The questions come in the note's order, which keeps a
 * section together and makes the per-section score legible as you go. Add one
 * if re-sitting the same exam starts feeling like recall rather than knowledge.
 */
export function ExamPane({ note, commands, onOpen, focusSignal }: ExamPaneProps) {
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  /** Whether `r` has been pressed on the question showing, cleared by moving off it. */
  const [shown, setShown] = useState(false);
  /**
   * Which button of the touch row has been tapped once and waits for a second.
   *
   * A thumb lands a button wide of where it aimed, `finish` writes a result
   * note and `close` drops the sitting, so those two ask before they act. Any
   * other move takes the question back. The keys do not ask: nobody presses
   * `g` by landing beside `t`.
   */
  const [armed, setArmed] = useState<"finish" | "close" | null>(null);
  /** Whether the touch row is showing the timer's lengths in place of its moves. */
  const [lengths, setLengths] = useState(false);
  /** Where the sitting was written, set once it has been graded. */
  const [wrote, setWrote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
  /** The digits typed before `t`, the way vim counts a motion. */
  const [count, setCount] = useState("");
  const panel = useRef<HTMLElement>(null);
  /** Set as the result note goes out, so a second `g` does not write a second one. */
  const writing = useRef(false);
  const queryClient = useQueryClient();

  const { data: text, isPending } = useQuery({
    queryKey: ["note", note],
    queryFn: () => fetchNote(note),
  });

  // Parsed once per read of the note rather than per render: a 72KB exam is a
  // few thousand lines of regex work, and a keystroke re-renders this.
  const exam = useMemo(() => (text === undefined ? null : parseExam(text)), [text]);

  const graded = useMemo(
    () => (exam === null || wrote === null ? null : gradeExam(exam, answers)),
    [exam, wrote, answers],
  );

  const question = exam?.questions[at];

  const finish = useCallback(
    async (open: Exam) => {
      if (writing.current) return;
      writing.current = true;
      // Also for a sitting the timer or `g` ended while `close` was asking.
      setArmed(null);

      const grade = gradeExam(open, answers);
      const clock = readClock(new Date());
      const path = resultPath(note, clock.date, clock.time);
      try {
        const made = await createNote(
          path,
          resultNote(open, note, grade, `${clock.date} ${clock.time}`),
        );
        setWrote(made.path);
        void queryClient.invalidateQueries({ queryKey: ["files"] });
      } catch (error) {
        // The sitting is not lost with the write: the score screen still draws
        // from state, and the bar says the note is the part that failed.
        setWrote(path);
        setFailed(error instanceof Error ? error.message : "could not write the result");
      }
    },
    [answers, note, queryClient],
  );

  const { running, label, out, toggle, start } = useExamTimer(exam, graded, finish);

  /** Add or drop one letter, keeping at most as many as the question wants. */
  const pick = useCallback(
    (letter: string) => {
      if (question === undefined) return;
      setArmed(null);
      setAnswers((previous) => {
        const held = previous[question.id] ?? [];
        if (held.includes(letter)) {
          return { ...previous, [question.id]: held.filter((one) => one !== letter) };
        }
        // The oldest pick drops out rather than the press being refused, so a
        // single-answer question is changed by naming the other letter and a
        // `select TWO` never needs a letter unpicked before the third is tried.
        //
        // Counted from the front rather than with a negative index: `pick` of 1
        // wants every held letter gone, and `slice(-0)` is `slice(0)`, which
        // keeps them all.
        const kept =
          held.length >= question.pick ? held.slice(held.length - question.pick + 1) : held;
        return { ...previous, [question.id]: [...kept, letter] };
      });
    },
    [question],
  );

  const move = useCallback(
    (by: number) => {
      if (exam === null) return;
      setAt((previous) => Math.min(Math.max(previous + by, 0), exam.questions.length - 1));
      setShown(false);
      setArmed(null);
    },
    [exam],
  );

  // `r` and `t`, named because a tap on the touch row asks for the same two.
  const reveal = () => {
    setArmed(null);
    setShown((previous) => !previous);
  };
  const timer = () => {
    setArmed(null);
    toggle(count);
  };

  function onLeaderKey(event: React.KeyboardEvent) {
    const sequence = pending + event.key;
    const wanted = sequence.slice(1);
    const run = leaderAction(wanted, commands);
    // A leader key can be more than one letter, so a sequence that still
    // prefixes one waits for the rest instead of being dropped.
    setPending(!run && leaderPrefix(wanted) ? sequence : "");
    if (!run) return;
    event.preventDefault();
    run();
  }

  /** The keys of a sitting in progress. True where the pane took `key`. */
  function sittingKey(key: string, open: Exam): boolean {
    const letter = key.toUpperCase();
    const known = question?.options.some((option) => option.letter === letter) === true;
    if (letter.length === 1 && LETTERS.includes(letter) && known) {
      pick(letter);
      return true;
    }
    switch (key) {
      case "l":
      case "n":
      case "Enter":
        move(1);
        break;
      case "h":
      case "p":
        move(-1);
        break;
      // `r` for reveal, which is the whole point of a practice exam: the
      // rationale is beside the question in the note, and reading it at the
      // moment you got it wrong is worth more than reading it at the end.
      case "r":
        reveal();
        break;
      // `t` for timer. Pressed while one runs it takes it away, which is the
      // way out of a length typed wrong.
      case "t":
        timer();
        break;
      case "g":
        void finish(open);
        break;
      case "q":
        commands.closeNote();
        break;
      default:
        return false;
    }
    return true;
  }

  /** Space opens the leader and a digit counts. True where `key` was one of them. */
  function leadOrCount(key: string): boolean {
    if (key === " ") {
      if (!beginLeader(paneOpener(commands))) setPending(key);
      return true;
    }
    // A count for `t`, the way vim counts a motion: `90t` is a 90 minute timer.
    // The letters a question is answered with stop at J, so a digit is free.
    if (key >= "0" && key <= "9") {
      setCount((previous) => previous + key);
      return true;
    }
    // Any other key ends the count, so a number typed and then abandoned does
    // not set the length of a timer started ten questions later.
    setCount("");
    return false;
  }

  /** Runs `key` once any count is read. True where the pane took it. */
  function paneKey(key: string): boolean {
    // Once the sitting is graded the only questions left are where to go, so
    // the answering keys are out of the way and Enter opens what was written.
    if (graded !== null) {
      if (key === "Enter" && wrote !== null) onOpen(wrote);
      else if (key === "q") commands.closeNote();
      else return false;
      return true;
    }
    if (exam !== null) return sittingKey(key, exam);
    if (key === "q") commands.closeNote();
    return false;
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    // A modifier holds itself down before the key it is held for arrives, and
    // a pending sequence that read it as a key would drop the sequence there.
    if (heldModifier(key)) return;

    if (pending) {
      onLeaderKey(event);
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (leadOrCount(key) || paneKey(key)) event.preventDefault();
  }

  // A freshly split pane is created focused and its first render is the only
  // chance it gets to say so. An unfocused pane is handed 0 and stays put.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  const answered = question === undefined ? [] : (answers[question.id] ?? []);
  const done =
    exam === null ? 0 : exam.questions.filter((one) => (answers[one.id] ?? []).length > 0).length;

  return (
    <section
      ref={panel}
      data-exam-pane
      // Focusable but out of the tab order, the way the todo pane and the book
      // pane take the cursor.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // A tapped button takes the focus, and Space on a focused button presses
      // it again on the way up, so the leader would also undo the pick. Handing
      // the focus back to the pane keeps every key meaning what it meant. The
      // buttons are out of the tab order for the same reason, which leaves no
      // other way for one to hold the focus while a key is pressed.
      onClick={() => panel.current?.focus()}
      aria-label="practice exam"
      className="flex h-full flex-col bg-k-bg font-mono outline-none"
    >
      <header className="flex items-center gap-3 border-b border-k-rule px-3 py-1">
        <span className={LABEL}>exam</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-k-ink">
          {exam?.title ?? note}
        </span>
        {running && (
          <span
            data-testid="exam-timer"
            className={`text-[13px] tabular-nums ${out ? "text-k-accent" : "text-k-muted"}`}
          >
            {label}
          </span>
        )}
        {exam !== null && graded === null && (
          <span className={LABEL}>
            {at + 1}/{exam.questions.length}
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-[13px] text-k-ink">
        {isPending && <p className="text-k-muted">Reading the note…</p>}

        {!isPending && exam === null && (
          <p role="alert" className="text-k-muted">
            No exam in <span className="text-k-ink">{note}</span>. A question is a{" "}
            <span className="text-k-ink">### Question 1.1</span> heading with lettered options under
            it. See <span className="text-k-ink">How-To-Exam</span> in the vault.
          </p>
        )}

        {graded !== null && <ExamScore graded={graded} wrote={wrote} failed={failed} />}

        {graded === null && question !== undefined && (
          <ExamQuestion question={question} answered={answered} shown={shown} onPick={pick} />
        )}
      </div>

      {/* The keys the footer names, for a screen with no keyboard under it. A
          mouse has the keys, so this stays out of the way of one. */}
      <nav
        aria-label="exam moves"
        className={`hidden border-k-rule border-t px-1 pointer-coarse:flex ${LABEL}`}
      >
        {graded === null && exam !== null && lengths && (
          <>
            {LENGTHS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                tabIndex={-1}
                aria-label={`${minutes} minute timer`}
                onClick={() => {
                  setLengths(false);
                  start(minutes);
                }}
                className={TAP}
              >
                {minutes}m
              </button>
            ))}
            <button type="button" tabIndex={-1} onClick={() => setLengths(false)} className={TAP}>
              back
            </button>
          </>
        )}
        {graded === null && exam !== null && !lengths && (
          <>
            <button type="button" tabIndex={-1} onClick={() => move(-1)} className={TAP}>
              prev
            </button>
            <button type="button" tabIndex={-1} onClick={() => move(1)} className={TAP}>
              next
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-pressed={shown}
              onClick={reveal}
              className={TAP}
            >
              reveal
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-pressed={running}
              // A running timer is taken away, as `t` takes it. Starting one
              // asks how long first: a finger has no count to type before it.
              onClick={() => {
                if (running) return timer();
                setArmed(null);
                setLengths(true);
              }}
              className={TAP}
            >
              timer
            </button>
            {/* The two that cannot be taken back sit behind a line, apart from
                the four a thumb reaches for on every question. */}
            <span aria-hidden="true" className="mx-1 my-2 border-k-rule border-l" />
            <AskingButton
              name="finish"
              armed={armed === "finish"}
              onClick={() => (armed === "finish" ? void finish(exam) : setArmed("finish"))}
            />
          </>
        )}
        {graded !== null && wrote !== null && (
          <button type="button" tabIndex={-1} onClick={() => onOpen(wrote)} className={TAP}>
            open result
          </button>
        )}
        {/* Only a sitting in progress is something to lose, so the score screen
            and a note with no exam close on the first tap. */}
        <AskingButton
          name="close"
          armed={armed === "close"}
          onClick={() =>
            exam === null || graded !== null || armed === "close"
              ? commands.closeNote()
              : setArmed("close")
          }
        />
      </nav>

      <footer className={STATUS}>{footerOf(graded !== null, exam, done, question, count)}</footer>
    </section>
  );
}

/** The keys the footer names. */
function footerOf(
  graded: boolean,
  exam: Exam | null,
  done: number,
  question: Question | undefined,
  count: string,
) {
  if (graded) return "Enter open the result · q close";
  if (exam === null) return "q close";
  const letters = LETTERS.slice(0, question?.options.length ?? 4);
  const timer = count === "" ? "t timer" : `${count}m timer on t`;
  const skipped = exam.skipped > 0 ? ` · ${exam.skipped} not askable` : "";
  return `${done} answered · ${letters} pick · h l move · r reveal · ${timer} · g finish · q close${skipped}`;
}

/** A button of the touch row that asks before it acts, `armed` once tapped. */
function AskingButton(props: { name: string; armed: boolean; onClick: () => void }) {
  const { name, armed, onClick } = props;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={armed}
      onClick={onClick}
      className={`${TAP} ${armed ? "text-k-accent" : ""}`}
    >
      {armed ? `${name}?` : name}
    </button>
  );
}
