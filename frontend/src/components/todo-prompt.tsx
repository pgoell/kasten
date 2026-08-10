import { useEffect, useId, useRef, useState } from "react";
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

interface TodoPromptProps {
  /** Called with what was typed, once Enter takes it. */
  onAdd: (input: string) => void;
  onClose: () => void;
  today: string;
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
export function TodoPrompt({ onAdd, onClose, today }: TodoPromptProps) {
  const [input, setInput] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();

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
      aria-label="Add todo"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={BACKDROP}
    >
      <div className={`${PANEL} ${PANEL_NARROW}`}>
        <div className={HEADER_ROW}>
          <label htmlFor={fieldId} className={LABEL}>
            todo
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

        {/* An <output> rather than a <p role="status">: same announcement, and
            the element carries it without the attribute. */}
        <output className={`${STATUS} truncate text-one-fg`}>{preview}</output>
      </div>
    </div>
  );
}
