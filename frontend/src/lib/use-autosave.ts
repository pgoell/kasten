import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveNote } from "@/lib/api";

/** Long enough that a sentence is one write, short enough to forget about. */
const QUIET_MS = 800;

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

/**
 * Writes one note back to the vault as it is edited.
 *
 * Text goes out once the typing stops, or at once on `save()`. Nothing is
 * written until the document changes, so opening a note never touches disk,
 * and nothing is written at all while no note is open.
 */
export function useAutosave(path: string | undefined) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  // The text waiting to go out, or null when disk is up to date. A ref, not
  // state: a keystroke must not re-render the tree around CodeMirror.
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();

  /** Resolves to whether the vault holds the text, so `<leader>q` can refuse. */
  const save = useCallback((): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;

    const content = pending.current;
    // Nothing waiting means disk is already up to date, which counts as saved.
    if (path === undefined || content === null) return Promise.resolve(true);
    pending.current = null;
    setStatus("saving");

    return saveNote(path, content).then(
      (note) => {
        // Typing during the write leaves newer text behind us, and that is not
        // saved however this one went. The cache waits on the same test: the
        // editor reloads from it, so writing the text that was in the air would
        // take those newer keystrokes off screen.
        //
        // What the vault answered with rather than what was sent, because the
        // two differ by the `modified` stamp `PUT` writes. Reopening a note
        // reads this cache, and so does the open editor.
        if (pending.current === null) {
          queryClient.setQueryData(["note", path], note.content);
          setStatus("saved");
        }
        return true;
      },
      () => {
        // Hold on to the text: the next keystroke or `:w` tries again.
        pending.current ??= content;
        setStatus("error");
        return false;
      },
    );
  }, [path, queryClient]);

  const change = useCallback(
    (doc: string) => {
      pending.current = doc;
      setStatus("unsaved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, QUIET_MS);
    },
    [save],
  );

  // React runs a cleanup with the render's own closure, so opening another
  // note writes what is pending to the note it was typed into, not to the one
  // that just replaced it. Unmounting flushes for the same reason. Nobody is
  // left to hear how the write went, so the promise is dropped on purpose.
  useEffect(
    () => () => {
      void save();
    },
    [save],
  );

  return { status, change, save };
}
