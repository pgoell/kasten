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

/**
 * What a tmux session may be called here.
 *
 * tmux forbids `.` and `:` in a session name, and anything needing
 * percent-encoding raises a question about how libwebsockets hands `?arg=`
 * fragments to the command. Narrower than either, and on screen in the prompt
 * so the rule is where the person typing can read it.
 */
export const SESSION_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** The rule, spelled for a reader rather than for a parser. */
const RULE = "letters, numbers, - and _, up to 64";

interface TerminalPromptProps {
  onOpen: (session: string) => void;
  onClose: () => void;
}

/**
 * Name the tmux session a pane attaches to, and Enter attaches to it.
 *
 * No list under the input, unlike the note prompt: ttyd cannot answer a query
 * about which sessions are running, and `tmux ls` inside any terminal finds a
 * name you have forgotten.
 *
 * Its own component rather than a fourth mode on `note-prompt.tsx`, which is
 * built around note paths end to end through `describeNotePath`,
 * `folderCandidates` and `noteAfterPrompt`. A session name is not a path.
 */
export function TerminalPrompt({ onOpen, onClose }: TerminalPromptProps) {
  const [input, setInput] = useState("");
  const field = useRef<HTMLInputElement>(null);
  /** Set once a session is on its way open, and the focus then belongs to the pane. */
  const opening = useRef(false);
  const fieldId = useId();

  const session = input.trim();
  const valid = SESSION_NAME.test(session);

  // The input takes the focus so the keys reach it rather than whatever was
  // focused when it opened, and hands it back on the way out, the way the note
  // prompt does. Opening a terminal is the exception: the pane behind this
  // takes the focus itself, and handing it back would leave a shell you have
  // to click before you can type in it.
  useEffect(() => {
    const opener = document.activeElement;
    field.current?.focus();
    return () => {
      if (opening.current) return;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        // The status line already says why, so a refusal is silent here.
        if (!valid) return;
        opening.current = true;
        onOpen(session);
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
    // onto the backdrop has moved the focus off it. Its own tabIndex is what
    // lets it hold the focus in that case.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Open terminal"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={BACKDROP}
    >
      <div className={`${PANEL} ${PANEL_NARROW}`}>
        <div className={HEADER_ROW}>
          <label htmlFor={fieldId} className={LABEL}>
            terminal
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
        <output className={STATUS}>{valid ? "" : RULE}</output>
      </div>
    </div>
  );
}
