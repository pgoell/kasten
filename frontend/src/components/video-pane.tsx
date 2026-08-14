import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchNote } from "@/lib/api";
import { type EditorCommands, LEADER } from "@/lib/key-bindings";
import { noteName } from "@/lib/note-path";
import { LABEL } from "@/lib/overlay-styles";
import { noteVideo } from "@/lib/video";

interface VideoPaneProps {
  /** The note holding the link. The pane reads it and never writes to it. */
  note: string;
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
}

/**
 * The video a note is about, playing beside the note.
 *
 * The point of the pane is that it is a pane: the player keeps its place while
 * the note scrolls under your typing, which an embed drawn into the note itself
 * cannot do. Everything that makes that work is the layout's already,
 * `<leader>l` to reach it and `<leader>q` to put it away.
 *
 * The note is the source of truth and this never writes to it, the way the exam
 * pane reads its note. The read shares the editor's own query, so opening the
 * player beside a note already on screen fetches nothing.
 *
 * ponytail: a click into the player takes the browser's focus without the
 * layout hearing about it, so the blue border stays on the note and keys go to
 * YouTube until you click back. A cross-origin frame tells its parent nothing,
 * and the window-blur trick that guesses it is more machinery than a wrong
 * border is worth. `<leader>h` still works because the pane's own focus signal
 * puts the cursor on this element rather than in the frame.
 */
export function VideoPane({ note, commands, focusSignal }: VideoPaneProps) {
  const panel = useRef<HTMLElement>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");

  const { data: text, isPending } = useQuery({
    queryKey: ["note", note],
    queryFn: () => fetchNote(note),
  });

  // The same URL across a re-render is the same `src`, so React keeps the frame
  // and the video plays on. Only a note whose *first* link changes restarts it,
  // which is the one case where the pane is genuinely showing something else.
  const source = text === undefined ? null : noteVideo(text);

  // A freshly focused pane is handed a raised signal and takes the cursor, the
  // way the image pane and the exam pane do. It has to: the pane holds no
  // CodeMirror, so without this the keys would keep going to whichever pane the
  // browser last left the cursor in.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  // The leader block the image pane, the exam pane and the todo pane each carry
  // their own copy of. Nothing else is bound: there is nothing here to operate,
  // the player owning every key that reaches it.
  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const binding = LEADER.find((entry) => entry.key === wanted);
      const partial = !binding && LEADER.some((entry) => entry.key.startsWith(wanted));
      setPending(partial ? sequence : "");

      if (binding) {
        event.preventDefault();
        commands[binding.command]();
      }
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (key === " ") {
      setPending(key);
      event.preventDefault();
    }
  }

  return (
    <section
      ref={panel}
      data-video-pane
      // Focusable but out of the tab order, the way every other pane holds the
      // cursor.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="video"
      className="flex h-full flex-col bg-one-bg font-mono outline-none"
    >
      <header className="flex items-center gap-3 border-b border-one-line px-3 py-1">
        <span className={`shrink-0 ${LABEL}`}>video</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-one-fg" title={note}>
          {noteName(note)}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
        {source === null ? (
          <p role="status" className="text-[13px] text-one-muted">
            {isPending ? "Reading the note" : "No video linked in this note"}
          </p>
        ) : (
          <iframe
            // Keyed on the URL so a note that changes which video it links gets
            // a new frame rather than a stale player told to load another one.
            key={source}
            src={source}
            title="video"
            // Fullscreen is the one thing worth handing over: a talk followed
            // properly is watched full width and paused back to the notes.
            // Nothing else is granted, so the frame gets no camera, no clipboard
            // and no autoplay it did not have to be told to start.
            allow="fullscreen; picture-in-picture"
            allowFullScreen
            // 16:9, which is what the player wants and what stops the frame
            // stretching to the pane's height on a wide split.
            className="aspect-video max-h-full w-full border-0"
          />
        )}
      </div>
    </section>
  );
}
