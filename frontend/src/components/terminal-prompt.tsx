import { useEffect, useId, useMemo, useRef, useState } from "react";
import { noteCandidates, rankCandidates } from "@/lib/fuzzy";
import {
  BACKDROP,
  HEADER_ROW,
  INPUT,
  LABEL,
  PANEL,
  PANEL_NARROW,
  ROW,
  STATUS,
} from "@/lib/overlay-styles";

/**
 * What a herdr session may be called here.
 *
 * herdr keeps a named session in a directory of its own, so the name lands on
 * a filesystem path, and anything needing percent-encoding raises a question
 * about how libwebsockets hands `?arg=` fragments to the command. Narrower
 * than either needs, and on screen in the prompt so the rule is where the
 * person typing can read it.
 */
export const SESSION_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** The rule, spelled for a reader rather than for a parser. */
const RULE = "letters, numbers, - and _, up to 64";

interface TerminalPromptProps {
  /** Every herdr session that already exists, as the backend named them. */
  sessions: string[];
  onOpen: (session: string) => void;
  onClose: () => void;
}

/**
 * Name the herdr session a pane attaches to, and Enter attaches to it.
 *
 * The list under the input is the sessions that already exist, ranked against
 * what has been typed, so a name half remembered is one Tab away. It offers
 * rather than restricts: a name nothing answers to is still taken, and starts
 * a session. Which of them are running is deliberately not shown, because
 * `herdr --session` attaches to a stopped one and starts a missing one alike,
 * and the backend only lists a directory.
 *
 * Its own component rather than a fourth mode on `note-prompt.tsx`, which is
 * built around note paths end to end through `describeNotePath`,
 * `folderCandidates` and `noteAfterPrompt`. A session name is not a path.
 */
export function TerminalPrompt({ sessions, onOpen, onClose }: TerminalPromptProps) {
  const [input, setInput] = useState("");
  /** Which row Tab would take. */
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  /** Set once a session is on its way open, and the focus then belongs to the pane. */
  const opening = useRef(false);
  const listId = useId();

  const session = input.trim();
  const valid = SESSION_NAME.test(session);
  // Keyed on `sessions` alone, so it survives a keystroke, the way the note
  // prompt derives its folders once per vault rather than once per letter.
  // `noteCandidates` rather than a derivation of its own: a session name has no
  // folder in it, so `nameAt` lands at 0 and the whole name takes the name
  // bonus, which is what ranking a bare name wants anyway.
  const candidates = useMemo(() => noteCandidates(sessions), [sessions]);
  const matches = useMemo(() => rankCandidates(candidates, session), [candidates, session]);
  // A shorter list can leave the highlight past the end. Typing puts it back on
  // the first row, so only a new list has to be clamped here.
  const cursor = Math.min(active, Math.max(matches.length - 1, 0));

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

  /** Fold a session name into the input, which is what Tab and a click do. */
  function pick(name: string) {
    setInput(name);
    setActive(0);
    // A click leaves the focus on the row it landed on, and Enter comes next.
    field.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const down = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n");
    const up = event.key === "ArrowUp" || (event.ctrlKey && event.key === "p");

    if (down || up) {
      if (matches.length === 0) return;
      // Without this the arrows take the caret to one end of the input, which
      // is where the browser sends them when nothing else does.
      event.preventDefault();
      setActive(down ? Math.min(cursor + 1, matches.length - 1) : Math.max(cursor - 1, 0));
      return;
    }

    switch (event.key) {
      case "Tab": {
        // Before the empty list bows out: the browser's own tab would take the
        // focus off the dialog, and every key that closes it goes with it.
        event.preventDefault();
        const name = matches[cursor];
        if (name) pick(name);
        break;
      }
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
          <label htmlFor={`${listId}-name`} className={LABEL}>
            terminal
          </label>
          <input
            id={`${listId}-name`}
            ref={field}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setActive(0);
            }}
            role="combobox"
            aria-expanded={matches.length > 0}
            aria-controls={listId}
            aria-activedescendant={matches.length > 0 ? `${listId}-${cursor}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
        </div>

        {matches.length > 0 && (
          // A div rather than a list, because a listbox is not a list of items
          // to a screen reader and marking it as both says it twice.
          <div id={listId} role="listbox" aria-label="Sessions" className="overflow-auto py-1">
            {matches.map((name, index) => (
              <button
                key={name}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === cursor}
                // Out of the tab order, because the focus stays in the input
                // and the highlight is how the list says where Tab would go.
                tabIndex={-1}
                onClick={() => {
                  opening.current = true;
                  onOpen(name);
                }}
                className={`${ROW} ${
                  index === cursor ? "bg-one-hover text-one-accent" : "text-one-fg"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {/* An <output> rather than a <p role="status">: same announcement, and
            the element carries it without the attribute. */}
        <output className={STATUS}>{valid ? "" : RULE}</output>
      </div>
    </div>
  );
}
