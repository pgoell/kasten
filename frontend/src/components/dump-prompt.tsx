import { useEffect, useId, useRef, useState } from "react";
import {
  BACKDROP,
  closeOnBackdrop,
  HEADER_ROW,
  INPUT,
  LABEL,
  PANEL,
  PANEL_NARROW,
  STATUS,
} from "@/lib/overlay-styles";

interface DumpPromptProps {
  /** Called with what was typed, trimmed, once Enter takes it. */
  onCapture: (text: string) => void;
  onClose: () => void;
  /** The day the thought is going to, drawn so a prompt open over midnight says so. */
  today: string;
}

/**
 * Type one thought, and Enter puts it in the `## Dump` of today's note.
 *
 * The todo prompt's shape and keys, and its own component rather than that one
 * with a flag: what makes the todo prompt is the shorthand, its preview and its
 * hints, and a thought has none of the three. What is left is an input and two
 * keys, which is less than the props a shared component would need.
 *
 * The prompt shuts on Enter rather than waiting for the vault. A thought is
 * caught the moment it is typed; the write is the caller's, and so is saying
 * whether it landed.
 */
export function DumpPrompt({ onCapture, onClose, today }: DumpPromptProps) {
  const [input, setInput] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  // The input takes the focus so the keys reach it, and hands it back on the
  // way out, the way the todo prompt does. That is what leaves the focus where
  // it was: the thought lands in a note nothing here opens.
  useEffect(() => {
    const opener = document.activeElement;
    field.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        const typed = input.trim();
        // Nothing typed is nothing to write.
        if (typed === "") return;
        onCapture(typed);
        break;
      }
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
      aria-label="Capture a thought"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={closeOnBackdrop(onClose)}
      className={BACKDROP}
    >
      <div className={`${PANEL} ${PANEL_NARROW}`}>
        <div className={HEADER_ROW}>
          <label htmlFor={fieldId} className={LABEL}>
            dump
          </label>
          <input
            id={fieldId}
            ref={field}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
            className={INPUT}
          />
        </div>
        <p className={STATUS}>into ## Dump of {today}</p>
      </div>
    </div>
  );
}
