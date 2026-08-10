import type { Suggestions } from "@/lib/todo-suggest";

interface TodoHintsProps {
  /** What can go in, read by the caller in its own spelling. Null draws nothing. */
  found: Suggestions | null;
  /** The text they go into, which is what the answer's offset counts along. */
  line: string;
  /** Called with the text a press leaves behind. */
  onTake: (edited: string) => void;
}

/**
 * The fields a todo has not got yet, each a press away.
 *
 * Under the input rather than over it: in the pane the row is one line of a
 * list, and a panel floating above the rows below it would cover the work it is
 * about. Tab reaches the buttons in the order they are drawn, Enter takes the
 * one it is on, and a click does the same, so this needs no keys of its own.
 *
 * The editor has no need of it, CodeMirror drawing its own completion list off
 * the same answers.
 */
export function TodoHints({ found, line, onTake }: TodoHintsProps) {
  if (found === null) return null;

  return (
    <div className="flex flex-wrap gap-1 px-3 pb-1">
      {found.options.map(({ name, hint, text }) => (
        <button
          key={name}
          type="button"
          data-testid="todo-hint"
          onClick={() => onTake(line.slice(0, found.from) + text)}
          className="rounded-sm bg-one-line/60 px-1.5 py-[1px] text-[12px] text-one-muted hover:text-one-fg focus:outline-1 focus:outline-one-cursor"
        >
          {hint} {name}
        </button>
      ))}
    </div>
  );
}
