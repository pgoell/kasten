import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveNote } from "@/lib/api";
import { digestOf } from "@/lib/vault-events";

/** Long enough that a sentence is one write, short enough to forget about. */
const QUIET_MS = 800;

export type SaveStatus = "saved" | "unsaved" | "saving" | "error" | "conflict";

/**
 * Writes one note back to the vault as it is edited.
 *
 * Text goes out once the typing stops, or at once on `save()`. Nothing is
 * written until the document changes, so opening a note never touches disk,
 * and nothing is written at all while no note is open.
 *
 * A write nobody here made stops the automatic one: the vault is the source of
 * truth, and the buffer is holding text that never saw what landed there. The
 * reader breaks the tie with `:w`.
 */
export function useAutosave(path: string | undefined) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  // The text waiting to go out, or null when disk is up to date. A ref, not
  // state: a keystroke must not re-render the tree around CodeMirror.
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The sha256 of the note the vault answered the last write with, which is
  // how that write is recognised coming back over the event stream.
  const lastWritten = useRef<string | null>(null);
  // The same reading as `status === "conflict"`, held where the quiet-period
  // timer can see it: that timer was scheduled by an older render, and the
  // status it closed over is the one from before the conflict.
  const conflicted = useRef(false);
  const queryClient = useQueryClient();

  /** Resolves to whether the vault holds the text, so `<leader>q` can refuse. */
  const save = useCallback((): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;

    const content = pending.current;
    // Nothing waiting means disk is already up to date, which counts as saved.
    if (path === undefined || content === null) return Promise.resolve(true);
    pending.current = null;
    // Reaching this at all is the reader deciding to overwrite: the timer stops
    // short of it while the note stands conflicted, and `:w` does not.
    conflicted.current = false;
    setStatus("saving");

    return saveNote(path, content).then(
      (note) => {
        // The note that came back and never the text that was sent: the two
        // differ by the `modified` stamp `PUT` writes, so what is on disk is
        // this one. Hashing the other would recognise nothing and read every
        // save of our own as somebody else's write.
        void digestOf(note.content).then((digest) => {
          lastWritten.current = digest;
        });
        // Typing during the write leaves newer text behind us, and that is not
        // saved however this one went. The cache waits on the same test: the
        // editor reloads from it, so writing the text that was in the air would
        // take those newer keystrokes off screen. Reopening a note reads this
        // cache too.
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
      // Typing settles nothing while the note stands conflicted: the vault
      // still holds text this buffer never saw, and reading `unsaved` would
      // promise a write the timer below no longer makes.
      if (!conflicted.current) setStatus("unsaved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!conflicted.current) void save();
      }, QUIET_MS);
    },
    [save],
  );

  /**
   * Called when the vault reports a write to the open note. Returns whether the
   * caller should reload: false means the buffer is dirty and now conflicted,
   * or the write was this hook's own and there is nothing to do.
   */
  const reconcile = useCallback((digest: string | null): boolean => {
    // Our own write coming back. Every write is reported, this hook's included,
    // and reading one as somebody else's would flag a conflict on every save
    // the typing carried on through.
    if (digest !== null && digest === lastWritten.current) return false;
    if (pending.current === null) return true;

    // Nothing is discarded and nothing is written. The buffer keeps the
    // reader's text, the vault keeps the other writer's, and `:w` is how the
    // reader says which one wins.
    conflicted.current = true;
    setStatus("conflict");
    return false;
  }, []);

  // React runs a cleanup with the render's own closure, so opening another
  // note writes what is pending to the note it was typed into, not to the one
  // that just replaced it. Unmounting flushes for the same reason. Nobody is
  // left to hear how the write went, so the promise is dropped on purpose.
  //
  // A conflicted note is flushed too, and that overwrites the vault without
  // anyone asking for it. The other way round loses the text on screen, which
  // by then is the only copy of it there is, and loses it silently. Leaving
  // the note open is what keeps the choice.
  useEffect(
    () => () => {
      void save();
    },
    [save],
  );

  return { status, change, save, reconcile };
}
