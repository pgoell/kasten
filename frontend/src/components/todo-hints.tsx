import type { Suggestions } from "@/lib/todo/todo-suggest";

interface TodoHintsProps {
  /** What can go in, read by the caller in its own spelling. Null draws nothing. */
  found: Suggestions | null;
  /** The text they go into, which is what the answer's offset counts along. */
  line: string;
  /** Called with the text a press leaves behind. */
  onTake: (edited: string) => void;
}

/**
 * The fields a todo has not got yet, as buttons under the input rather than over it,
 * so they do not cover the rows. Tab and Enter work on them with no keys of their own.
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
          className="rounded-sm bg-k-rule/60 px-1.5 py-[1px] text-[12px] text-k-muted hover:text-k-ink focus:outline-1 focus:outline-k-accent"
        >
          {hint} {name}
        </button>
      ))}
    </div>
  );
}
