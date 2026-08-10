import { useEffect, useId, useRef, useState } from "react";
import { TodoHints } from "@/components/todo-hints";
import {
  BACKDROP,
  HEADER_ROW,
  INPUT,
  LABEL,
  PANEL,
  PANEL_NARROW,
  STATUS,
} from "@/lib/overlay-styles";
import { formatTodo } from "@/lib/todo";
import { expandShorthand } from "@/lib/todo-shorthand";
import { shorthandSuggestions } from "@/lib/todo-suggest";

interface TodoPromptProps {
  /** Called with what was typed, once Enter takes it. */
  onAdd: (input: string) => void;
  onClose: () => void;
  today: string;
  /**
   * The words of the todo this is going under, where the pane's `s` opened it.
   *
   * Drawn rather than acted on: the write is the caller's, and the two presses
   * put the line in different notes, so the prompt has to say which one this is.
   */
  under?: string;
}

/**
 * Type a todo in shorthand, and Enter puts it in today's note.
 *
 * The line under the input is what the vault is about to get, read out of what
 * has been typed by the same two functions that will write it. So a `due:` that
 * is not a date shows as words rather than vanishing, and the spelling of a
 * priority is checked before it lands on disk rather than after.
 *
 * Its own component rather than a mode of `note-prompt.tsx`, for the reason the
 * terminal prompt is: that one is built around note paths end to end, through
 * `describeNotePath`, `folderCandidates` and `noteAfterPrompt`. A todo is not a
 * path.
 */
export function TodoPrompt({ onAdd, onClose, today, under }: TodoPromptProps) {
  const [input, setInput] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  /** What this press is: a todo in today's note, or a part of the row it opened on. */
  const what = under === undefined ? "todo" : "part";

  const typed = input.trim();
  // Nothing typed draws no line: a preview of a todo with no words in it is
  // one Enter will refuse anyway.
  const preview = typed === "" ? "" : formatTodo(expandShorthand(typed, today));

  // The input takes the focus so the keys reach it rather than whatever was
  // focused when it opened, and hands it back on the way out, the way the note
  // prompt does. What is behind this is the pane the `a` came from either way,
  // the todo landing in a note nothing here opens.
  useEffect(() => {
    const opener = document.activeElement;
    field.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "Enter":
        // A hint has the focus and Enter is taking that, not writing the todo.
        // The button's own click does the work; this key never reaches here
        // from the input, which nothing else in the panel can be.
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        // Nothing typed is nothing to write, and the empty preview says so.
        if (typed === "") return;
        onAdd(typed);
        break;
      case "Escape":
        event.preventDefault();
        onClose();
        break;
      default:
        // Everything else is typing, and belongs to the input.
        return;
    }
  }

  return (
    // The dialog reads the keys, not the input, so they still land once a click
    // onto the backdrop has moved the focus off it.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${what}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={BACKDROP}
    >
      <div className={`${PANEL} ${PANEL_NARROW}`}>
        <div className={HEADER_ROW}>
          <label htmlFor={fieldId} className={LABEL}>
            {what}
          </label>
          <input
            id={fieldId}
            ref={field}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
        </div>

        {/* Which todo the part is going under, so the two presses that open
            this prompt cannot be told apart by the label alone. */}
        {under !== undefined && (
          <p className={`${STATUS} truncate text-one-muted`}>under {under}</p>
        )}

        {/* An <output> rather than a <p role="status">: same announcement, and
            the element carries it without the attribute. */}
        <output className={`${STATUS} truncate text-one-fg`}>{preview}</output>

        {/* Below the preview, so the line the vault is about to get stays under
            the input as it is typed and the buttons come after both. Tab from
            the input reaches them in that order. */}
        <TodoHints
          found={shorthandSuggestions(input, today)}
          line={input}
          onTake={(edited) => {
            setInput(edited);
            field.current?.focus();
          }}
        />
      </div>
    </div>
  );
}
