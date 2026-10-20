import type { Mention, SearchHit } from "@/lib/api";
import { ROW, TAP } from "@/lib/overlay-styles";
import { parseTodo, STATE_SYMBOL } from "@/lib/todo";
import { isMention } from "@/lib/use-search-hits";

/** One row of the list, and beside it a `link` button for an unlinked mention. */
export function SearchRow({
  hit,
  optionId,
  selected,
  todos,
  onOpen,
  onLink,
}: {
  hit: SearchHit | Mention;
  optionId: string;
  selected: boolean;
  todos: boolean;
  onOpen(): void;
  onLink(): void;
}) {
  // Null on every mode but todos, and on a todo line the filter above cannot
  // hand back, which is why the row still draws the line it was given rather
  // than nothing at all.
  const todo = todos ? parseTodo(hit.text) : null;
  const option = (
    <button
      id={optionId}
      type="button"
      role="option"
      aria-selected={selected}
      // Out of the tab order: the focus stays in the input, and the highlight
      // is how the list says what Enter would open.
      tabIndex={-1}
      onClick={onOpen}
      // `min-w-0` lets the row shrink below its path beside a mention's
      // `link` button, which a long path would otherwise push off a phone.
      className={`${ROW} ${TAP} flex min-w-0 gap-3 ${selected ? "bg-one-hover" : ""}`}
    >
      <span
        // Capped below `md`, where a long path alone is wider than the list
        // and would push the line it found off the side.
        className={`shrink-0 truncate max-md:max-w-[45%] ${selected ? "text-one-accent" : "text-one-muted"}`}
      >
        {hit.path}:{hit.line}
      </span>
      {/* The line itself never wraps: one row per hit is what makes the list
          countable at a glance. */}
      <span className="min-w-0 flex-1 truncate text-one-fg">
        {todo === null ? hit.text : `${STATE_SYMBOL[todo.state]} ${todo.text}`}
      </span>
      {/* Out of the truncation, so a long todo loses its words rather than
          the date they are due on. */}
      {todo?.due !== undefined && <span className="shrink-0 text-one-muted">📅 {todo.due}</span>}
    </button>
  );
  if (!isMention(hit)) return option;
  // Beside the row and not inside it: a button in a button is no markup a
  // browser keeps, and a click inside would reach the row and open the note
  // too.
  return (
    <div className="flex">
      {option}
      <button
        type="button"
        tabIndex={-1}
        // The press would move the focus here, and the keys belong to the
        // input: Tab and Ctrl+Enter have to go on working after a tap.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onLink}
        className={`${TAP} flex shrink-0 cursor-pointer px-3 text-[11px] text-one-accent hover:bg-one-hover`}
      >
        link
      </button>
    </div>
  );
}
