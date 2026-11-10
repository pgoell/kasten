import { TodoLegend } from "@/components/todo-legend";
import type { TodoState } from "@/lib/todo/todo";
import type { Mode, Row } from "@/lib/todo/use-todo-rows";

interface FooterProps {
  board: boolean;
  cards: number;
  listed: Mode;
  shown: Row[];
  timers: number;
  coarse: boolean;
  picking: boolean;
  counts: Record<TodoState, number>;
}

/**
 * The count of what is drawn, and the keys this phase binds. Over the open list
 * the count is the legend, so the pane spends no row of its own on it. A coarse
 * pointer gets the count alone.
 */
export function TodoFooter(p: FooterProps) {
  return (
    /* Only the keys this phase binds. A footer offering one that does
        nothing is worse than a short one. A finger has no keys, as the
        strip shows, so a coarse pointer gets the count alone: beside the
        hints a phone squeezed it to a word per line (#488). */
    <footer
      data-testid="todo-footer"
      className="flex items-center justify-between gap-3 border-t border-k-rule px-3 py-1 text-[11px] text-k-muted"
    >
      <span className="flex max-w-full shrink-0 items-center gap-3">
        <Count {...p} />
      </span>
      {p.coarse ? null : <Keys board={p.board} picking={p.picking} />}
    </footer>
  );
}

function Count({ board, cards, listed, shown, timers, picking, counts }: FooterProps) {
  if (board) return `${cards} on the board`;
  if (listed === "done") return `${shown.length} finished`;
  // The open list's legend counts each state; the picker and next list keep the words.
  if (listed === "open" && !picking)
    return (
      <>
        <TodoLegend counts={counts} />
        {timers > 0 && `${timers} running`}
      </>
    );
  const blocked = shown.filter(({ todo }) => todo.state === "blocked").length;
  const onSomebody = shown.filter(({ todo }) => todo.state === "waiting").length;
  const toReview = shown.filter(({ todo }) => todo.state === "review").length;
  return (
    <>
      {shown.length - blocked - onSomebody - toReview} open, {blocked} blocked
      {onSomebody > 0 && `, ${onSomebody} waiting`}
      {toReview > 0 && `, ${toReview} to review`}
      {timers > 0 && `, ${timers} running`}
    </>
  );
}

/** One line however narrow the pane, cut short at the end; `?` lists every key. */
const HINTS = "min-w-0 truncate";

function Keys({ board, picking }: { board: boolean; picking: boolean }) {
  if (picking)
    return (
      <span className={HINTS}>
        j k move&ensp;&ensp;/ filter&ensp;&ensp;Enter pick&ensp;&ensp;Escape cancel
      </span>
    );
  if (board)
    return (
      <span className={HINTS}>
        h l column&ensp;&ensp;j k card&ensp;&ensp;x cycle&ensp;&ensp;O P V X B W R
        state&ensp;&ensp;p project&ensp;&ensp;m refile&ensp;&ensp;g lanes&ensp;&ensp;c
        list&ensp;&ensp;v view&ensp;&ensp;/ filter&ensp;&ensp;q close
      </span>
    );
  return (
    <span className={HINTS}>
      x cycle&ensp;&ensp;O P V X B W R state&ensp;&ensp;a add&ensp;&ensp;s part&ensp;&ensp;i
      edit&ensp;&ensp;b blocked by&ensp;&ensp;t timer&ensp;&ensp;m refile&ensp;&ensp;@
      agent&ensp;&ensp;d done&ensp;&ensp;n next&ensp;&ensp;v view&ensp;&ensp;c board&ensp;&ensp;/
      filter&ensp;&ensp;q close&ensp;&ensp;Escape editor
    </span>
  );
}
