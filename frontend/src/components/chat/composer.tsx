import type { RefObject } from "react";
import { useViewport } from "@/lib/ui/input/use-viewport";

/** A skill to start, as a pill. */
const CHIP =
  "shrink-0 rounded-full border border-k-rule bg-k-paper px-3 py-1 font-mono text-[12px] text-k-ink-soft transition-colors hover:border-k-accent hover:text-k-accent pointer-coarse:min-h-11 pointer-coarse:px-4";

interface ComposerProps {
  box: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (text: string) => void;
  send: (text: string) => void;
  /** Shown while a run goes on, beside the send button. */
  onStop?: () => void;
  /** Skills as pills over the box; empty while the pane shows them as cards. */
  skills: string[];
}

const ROUND =
  "grid size-8 shrink-0 place-items-center rounded-full transition-opacity pointer-coarse:size-11";

/** The box a message is written in, with its buttons inside the same frame. */
export function Composer({ box, draft, setDraft, send, onStop, skills }: ComposerProps) {
  const { coarse } = useViewport();
  const empty = draft.trim() === "";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 px-3 pt-1 pb-3">
      {skills.length > 0 && (
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none]">
          {skills.map((skill) => (
            <button key={skill} type="button" className={CHIP} onClick={() => send(skill)}>
              {skill}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2 rounded-2xl border border-k-rule bg-k-paper py-1.5 pr-1.5 pl-3.5 shadow-sm transition-colors focus-within:border-k-accent/60"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={box}
          value={draft}
          rows={Math.min(6, draft.split("\n").length)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends from a keyboard. On a phone's it breaks the line as
            // it does everywhere else there, and the button sends.
            // Not the Enter that picks a word in an input method's list.
            const composing = event.nativeEvent.isComposing;
            if (event.key === "Enter" && !event.shiftKey && !coarse && !composing) {
              event.preventDefault();
              send(draft);
            }
          }}
          aria-label="Message"
          placeholder="Ask Claude, or type /skill"
          autoComplete="off"
          // 16px under a finger: Safari zooms the page on the focus of anything smaller.
          className="max-h-40 min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-k-15 text-k-ink outline-none placeholder:text-k-muted pointer-coarse:text-base"
        />
        {onStop !== undefined && (
          <button
            type="button"
            aria-label="Stop"
            title="Stop the run"
            className={`${ROUND} bg-k-surface text-k-ink hover:bg-k-rule`}
            onClick={onStop}
          >
            <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-current" />
          </button>
        )}
        <button
          type="submit"
          aria-label="Send"
          title="Send"
          disabled={empty}
          className={`${ROUND} bg-k-accent text-k-paper disabled:bg-k-surface disabled:text-k-muted`}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none">
            <path
              d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
      {!coarse && (
        <p className="px-1 text-[11px] text-k-muted">
          Enter sends, Shift+Enter breaks the line, Esc leaves the box.
        </p>
      )}
    </div>
  );
}
