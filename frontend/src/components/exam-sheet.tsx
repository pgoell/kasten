import type { Grade, Question } from "@/lib/exam";
import { LABEL } from "@/lib/overlay-styles";

/** The score of a graded sitting, and where its result note was written. */
export function ExamScore({
  graded,
  wrote,
  failed,
}: {
  graded: Grade;
  wrote: string | null;
  failed: string | null;
}) {
  return (
    <div data-testid="exam-score">
      <p className="text-[15px]">
        <strong>
          {graded.right}/{graded.asked}
        </strong>{" "}
        ({graded.asked === 0 ? 0 : Math.round((100 * graded.right) / graded.asked)}%)
      </p>
      <ul className="mt-3 space-y-[2px] text-k-muted">
        {graded.sections.map((score) => (
          <li key={score.section}>
            {score.section}: {score.right}/{score.asked}
          </li>
        ))}
      </ul>
      {wrote !== null && failed === null && (
        <p className="mt-4 text-k-muted">
          Written to <span className="text-k-ink">{wrote}</span>. Enter opens it.
        </p>
      )}
      {failed !== null && (
        <p role="alert" className="mt-4 text-k-muted">
          The result note could not be written: {failed}
        </p>
      )}
    </div>
  );
}

/** One question of the sitting: its options, picked by letter, and the rationale once shown. */
export function ExamQuestion({
  question,
  answered,
  shown,
  onPick,
}: {
  question: Question;
  answered: string[];
  shown: boolean;
  onPick(letter: string): void;
}) {
  return (
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
              className={held ? "text-k-ink" : "text-k-muted"}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-pressed={held}
                onClick={() => onPick(option.letter)}
                className="block w-full text-left pointer-coarse:min-h-11"
              >
                <span className={held ? "text-k-accent" : ""}>
                  {held ? "●" : "○"} {option.letter}.
                </span>{" "}
                {option.text}
                {shown && right && <span className="text-k-accent"> ✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {shown && (
        <div data-testid="exam-rationale" className="mt-4 border-k-rule border-t pt-3">
          <p className={LABEL}>Correct: {question.correct.join(", ") || "the note does not say"}</p>
          <p className="mt-2 whitespace-pre-wrap text-k-muted">{question.rationale}</p>
        </div>
      )}
    </div>
  );
}
