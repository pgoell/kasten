import { ROW } from "@/lib/overlay-styles";
import type { projectChoices } from "@/lib/todo-board";

/** The project picker a `p` opens over the board, for the card named by `title`. */
export function BoardPicker({
  title,
  choices,
  at,
  coarse,
  onPick,
  onCancel,
}: {
  title: string;
  choices: ReturnType<typeof projectChoices>;
  at: number;
  coarse: boolean;
  onPick(choice: ReturnType<typeof projectChoices>[number]): void;
  onCancel(): void;
}) {
  return (
    // Stuck to the top of the scroll, so a `p` far down a long column
    // opens a picker that is in sight.
    <div
      data-testid="todo-project-pick"
      className="sticky top-0 z-10 border-b border-one-line bg-one-bg pb-1"
    >
      <div className="flex items-center gap-3 px-3 text-[11px] text-one-accent">
        <span className="min-w-0 flex-1 truncate py-1">project for: {title}</span>
        {/* Escape by finger, as the list's blocker picker has it. */}
        {coarse && (
          <button
            type="button"
            tabIndex={-1}
            onClick={onCancel}
            className="min-h-11 shrink-0 px-3 text-one-muted"
          >
            cancel
          </button>
        )}
      </div>
      {choices.length === 0 && (
        <p className="px-3 py-1 text-[13px] text-one-muted">no folder under 02 Projects</p>
      )}
      {choices.map((choice, index) => (
        <button
          key={choice.folder}
          type="button"
          tabIndex={-1}
          onClick={() => onPick(choice)}
          aria-current={index === at}
          className={`${ROW} block ${index === at ? "bg-one-cursor/15 text-one-fg" : "text-one-muted"} ${coarse ? "min-h-11" : ""}`}
        >
          {choice.name}
        </button>
      ))}
    </div>
  );
}
