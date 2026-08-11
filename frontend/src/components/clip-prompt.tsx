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

/** The rule, spelled for a reader rather than for a parser. */
const RULE = "paste an http or https address";

interface ClipPromptProps {
  /** Read the page and put it in the vault. Rejects with what to tell the reader. */
  onClip: (url: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Paste a web address, and Enter puts the page in the inbox as a note.
 *
 * No list under the input, unlike every other overlay: there is nothing to
 * offer. What sits there instead is the one line saying what is happening,
 * because a clip is the only thing kasten does that waits on somebody else's
 * server, and a prompt that looks asleep for four seconds reads as broken.
 *
 * A failure keeps the prompt open carrying the reason. The address is still in
 * the input, which is where it has to be: half of these are a mistyped path or
 * a page that wants a login, and both are fixed by editing what was pasted.
 */
export function ClipPrompt({ onClip, onClose }: ClipPromptProps) {
  const [input, setInput] = useState("");
  /** What the line at the bottom says, and "" while it has nothing to add. */
  const [status, setStatus] = useState("");
  /** True from the press until the vault has the note or the reason it has not. */
  const [reading, setReading] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();

  const url = input.trim();

  // The input takes the focus so the paste lands in it rather than in whatever
  // was focused when it opened, and hands it back on the way out. A clip that
  // works opens the note, and the pane takes the focus itself.
  useEffect(() => {
    const opener = document.activeElement;
    field.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function clip() {
    if (reading || url === "") return;
    if (!/^https?:\/\/\S+$/i.test(url)) {
      setStatus(RULE);
      return;
    }

    setReading(true);
    setStatus("Reading the page…");
    onClip(url).then(
      () => {
        // Nothing. The note is open and this prompt is unmounted.
      },
      (error: unknown) => {
        setReading(false);
        setStatus(error instanceof Error ? error.message : "That page could not be read");
      },
    );
  }

  function onKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        clip();
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
      aria-label="Import a web page"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={BACKDROP}
    >
      <div className={`${PANEL} ${PANEL_NARROW}`}>
        <div className={HEADER_ROW}>
          <label htmlFor={`${listId}-url`} className={LABEL}>
            import
          </label>
          <input
            id={`${listId}-url`}
            ref={field}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setStatus("");
            }}
            type="url"
            placeholder="https://"
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
        </div>

        {/* An <output> rather than a <p role="status">: same announcement, and
            the element carries it without the attribute. */}
        <output className={STATUS}>{status}</output>
      </div>
    </div>
  );
}
