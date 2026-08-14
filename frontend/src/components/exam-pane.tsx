import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createNote, fetchNote } from "@/lib/api";
import { readClock } from "@/lib/clock";
import {
  type Answers,
  type Exam,
  gradeExam,
  LETTERS,
  parseExam,
  resultNote,
  resultPath,
} from "@/lib/exam";
import { type EditorCommands, LEADER } from "@/lib/key-bindings";
import { LABEL, STATUS } from "@/lib/overlay-styles";

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
  /** Where the sitting was written, set once it has been graded. */
  const [wrote, setWrote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
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

  /** Add or drop one letter, keeping at most as many as the question wants. */
  const pick = useCallback(
    (letter: string) => {
      if (question === undefined) return;
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
    },
    [exam],
  );

  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const binding = LEADER.find((entry) => entry.key === wanted);
      const partial = !binding && LEADER.some((entry) => entry.key.startsWith(wanted));
      setPending(partial ? sequence : "");

      if (binding) {
        event.preventDefault();
        commands[binding.command]();
      }
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (key === " ") {
      setPending(key);
      event.preventDefault();
      return;
    }

    // Once the sitting is graded the only questions left are where to go, so
    // the answering keys are out of the way and Enter opens what was written.
    if (graded !== null) {
      if (key === "Enter" && wrote !== null) onOpen(wrote);
      else if (key === "q") commands.closeNote();
      else return;
      event.preventDefault();
      return;
    }

    if (exam === null) {
      if (key === "q") commands.closeNote();
      return;
    }

    const letter = key.toUpperCase();
    if (letter.length === 1 && LETTERS.includes(letter) && question !== undefined) {
      const known = question.options.some((option) => option.letter === letter);
      if (known) {
        pick(letter);
        event.preventDefault();
        return;
      }
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
        setShown((previous) => !previous);
        break;
      case "g":
        void finish(exam);
        break;
      case "q":
        commands.closeNote();
        break;
      default:
        return;
    }
    event.preventDefault();
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
      aria-label="practice exam"
      className="flex h-full flex-col bg-one-bg font-mono outline-none"
    >
      <header className="flex items-center gap-3 border-b border-one-line px-3 py-1">
        <span className={LABEL}>exam</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-one-fg">
          {exam?.title ?? note}
        </span>
        {exam !== null && graded === null && (
          <span className={LABEL}>
            {at + 1}/{exam.questions.length}
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-[13px] text-one-fg">
        {isPending && <p className="text-one-muted">Reading the note…</p>}

        {!isPending && exam === null && (
          <p role="alert" className="text-one-muted">
            No exam in <span className="text-one-fg">{note}</span>. A question is a{" "}
            <span className="text-one-fg">### Question 1.1</span> heading with lettered options
            under it. See <span className="text-one-fg">How-To-Exam</span> in the vault.
          </p>
        )}

        {graded !== null && (
          <div data-testid="exam-score">
            <p className="text-[15px]">
              <strong>
                {graded.right}/{graded.asked}
              </strong>{" "}
              ({graded.asked === 0 ? 0 : Math.round((100 * graded.right) / graded.asked)}%)
            </p>
            <ul className="mt-3 space-y-[2px] text-one-muted">
              {graded.sections.map((score) => (
                <li key={score.section}>
                  {score.section}: {score.right}/{score.asked}
                </li>
              ))}
            </ul>
            {wrote !== null && failed === null && (
              <p className="mt-4 text-one-muted">
                Written to <span className="text-one-fg">{wrote}</span>. Enter opens it.
              </p>
            )}
            {failed !== null && (
              <p role="alert" className="mt-4 text-one-muted">
                The result note could not be written: {failed}
              </p>
            )}
          </div>
        )}

        {graded === null && question !== undefined && (
          <div data-testid="exam-question">
            <p className={LABEL}>
              {question.id}
              {question.section !== "" && ` · ${question.section}`}
              {question.pick > 1 && ` · select ${question.pick}`}
            </p>
            <p className="mt-2 whitespace-pre-wrap">{question.stem}</p>
            <ul className="mt-3 space-y-1">
              {question.options.map((option) => {
                const held = answered.includes(option.letter);
                const right = question.correct.includes(option.letter);
                return (
                  <li
                    key={option.letter}
                    data-picked={held || undefined}
                    className={held ? "text-one-fg" : "text-one-muted"}
                  >
                    <span className={held ? "text-one-accent" : ""}>
                      {held ? "●" : "○"} {option.letter}.
                    </span>{" "}
                    {option.text}
                    {shown && right && <span className="text-one-accent"> ✓</span>}
                  </li>
                );
              })}
            </ul>
            {shown && (
              <div data-testid="exam-rationale" className="mt-4 border-one-line border-t pt-3">
                <p className={LABEL}>
                  Correct: {question.correct.join(", ") || "the note does not say"}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-one-muted">{question.rationale}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className={STATUS}>
        {graded !== null
          ? "Enter open the result · q close"
          : exam === null
            ? "q close"
            : `${done} answered · ${LETTERS.slice(0, question?.options.length ?? 4)} pick · h l move · r reveal · g finish · q close${
                exam.skipped > 0 ? ` · ${exam.skipped} not askable` : ""
              }`}
      </footer>
    </section>
  );
}
