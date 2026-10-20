import type { Mode, Row } from "@/lib/use-todo-rows";

/**
 * The count of what is drawn, and the keys this phase binds. A coarse pointer
 * gets the count alone.
 */
export function TodoFooter(p: {
  board: boolean;
  cards: number;
  listed: Mode;
  shown: Row[];
  timers: number;
  coarse: boolean;
  picking: boolean;
}) {
  const { board, cards, listed, shown, timers, coarse, picking } = p;
  const blocked = shown.filter(({ todo }) => todo.state === "blocked").length;
  const onSomebody = shown.filter(({ todo }) => todo.state === "waiting").length;
  const toReview = shown.filter(({ todo }) => todo.state === "review").length;

  return (
    /* Only the keys this phase binds. A footer offering one that does
        nothing is worse than a short one. A finger has no keys, as the
        strip shows, so a coarse pointer gets the count alone: beside the
        hints a phone squeezed it to a word per line (#488). */
    <footer
      data-testid="todo-footer"
      className="flex justify-between gap-3 border-t border-one-line px-3 py-1 text-[11px] text-one-muted"
    >
      <span>
        {board ? (
          `${cards} on the board`
        ) : listed === "done" ? (
          `${shown.length} finished`
        ) : (
          <>
            {shown.length - blocked - onSomebody - toReview} open, {blocked} blocked
            {onSomebody > 0 && `, ${onSomebody} waiting`}
            {toReview > 0 && `, ${toReview} to review`}
            {timers > 0 && `, ${timers} running`}
          </>
        )}
      </span>
      {coarse ? null : picking ? (
        <span>j k move&ensp;&ensp;/ filter&ensp;&ensp;Enter pick&ensp;&ensp;Escape cancel</span>
      ) : board ? (
        <span>
          h l column&ensp;&ensp;j k card&ensp;&ensp;x cycle&ensp;&ensp;O P V X B W R
          state&ensp;&ensp;p project&ensp;&ensp;m refile&ensp;&ensp;g lanes&ensp;&ensp;c
          list&ensp;&ensp;v view&ensp;&ensp;/ filter&ensp;&ensp;q close
        </span>
      ) : (
        <span>
          x cycle&ensp;&ensp;O P V X B W R state&ensp;&ensp;a add&ensp;&ensp;s part&ensp;&ensp;i
          edit&ensp;&ensp;b blocked by&ensp;&ensp;t timer&ensp;&ensp;m refile&ensp;&ensp;@
          agent&ensp;&ensp;d done&ensp;&ensp;n next&ensp;&ensp;v view&ensp;&ensp;c
          board&ensp;&ensp;/ filter&ensp;&ensp;q close&ensp;&ensp;Escape editor
        </span>
      )}
    </footer>
  );
}
