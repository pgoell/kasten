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
  // The note the vault answered the last write with, in the two shapes the two
  // readers of it need. The text is for the editor, which holds the text it is
  // asking about and would otherwise wait on a hash it does not have yet; the
  // sha256 is for the event, which carries a digest and nothing else.
  const lastWritten = useRef<string | null>(null);
  const lastText = useRef<string | null>(null);
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
        lastText.current = note.content;
        void digestOf(note.content).then(
          (digest) => {
            lastWritten.current = digest;
          },
          (error: unknown) => {
            // `crypto.subtle` is missing outside a secure context, which is a
            // proxy serving the app over plain http and nothing else. Left
            // unhandled it is an unhandled rejection per save; handled, the
            // hook simply recognises none of its own writes, so a save the
            // typing carried on through raises a conflict the reader clears
            // with `:w`. Wrong in the direction that writes nothing.
            if (!(error instanceof TypeError)) throw error;
          },
        );
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

  /**
   * Write what is waiting on the way to doing something else, refusing while
   * the vault has moved past the buffer. Answers whether the vault holds it.
   *
   * Every key that saves before it acts goes through here: closing the note,
   * moving it, moving a folder above it, reading its links. A save while the
   * note stands conflicted is the deliberate overwrite `:w` means, and a key
   * that was pressed for something else does not get to make that call on the
   * reader's behalf. `false` leaves the command undone.
   */
  const saveFirst = useCallback(
    (): Promise<boolean> => (conflicted.current ? Promise.resolve(false) : save()),
    [save],
  );

  /**
   * Throw away what is waiting and take the note off conflict, which is what
   * `:e!` says. Answers whether it did.
   *
   * `:e` without the bang gets a no while the buffer holds text nobody has
   * written, the way vim declines to abandon a modified buffer. The caller
   * reads the vault before asking, so a read that failed leaves the text and
   * the warning exactly where they were.
   */
  const revert = useCallback((force: boolean): boolean => {
    if (pending.current !== null && !force) return false;

    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    conflicted.current = false;
    setStatus("saved");
    return true;
  }, []);

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
   * Whether the editor may put `text` in, asked at the moment it would.
   *
   * A buffer with nothing waiting takes anything: that is the reload doing its
   * job. A buffer with text in it takes nothing, and what the text is decides
   * only whether that is worth reporting. Somebody else's write is the conflict
   * this hook exists for. Our own answer coming back is not: it is one `PUT`
   * behind the keystroke that beat it here, it carries no words the reader has
   * not already got, and flagging it would stop the autosave of a reader who
   * did nothing but keep typing. The stamp in it reaches the buffer on the next
   * quiet write instead, which is a round trip away and costs nothing.
   */
  const allowReload = useCallback((text: string): boolean => {
    if (pending.current === null) return true;
    if (text === lastText.current) return false;

    conflicted.current = true;
    setStatus("conflict");
    return false;
  }, []);

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
  // by then is the only copy of it there is, and loses it silently. This is
  // the one path with nobody standing in front of it to be asked, which is
  // why `saveFirst` above exists for the paths that have somebody.
  useEffect(
    () => () => {
      void save();
    },
    [save],
  );

  return { status, change, save, saveFirst, revert, allowReload, reconcile };
}
