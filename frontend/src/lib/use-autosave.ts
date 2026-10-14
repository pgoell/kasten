import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveNote } from "@/lib/api";
import { dropText, heldText, holdText, sameText } from "@/lib/held-text";
import { digestOf } from "@/lib/vault-events";

/** Long enough that a sentence is one write, short enough to forget about. */
const QUIET_MS = 800;

/**
 * A note left with a failed write has no reading of its own here: its text is
 * held (`held-text.ts`) and the bar lists it beside whatever note is open.
 */
export type SaveStatus = "saved" | "unsaved" | "saving" | "error" | "conflict";

/** One fewer write in the air for `note`, taking the entry when it reaches none. */
function lower(counts: Map<string, number>, note: string): void {
  const left = (counts.get(note) ?? 0) - 1;
  if (left > 0) counts.set(note, left);
  else counts.delete(note);
}

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
  // What the vault answered the failed write with, kept for the bar to show on
  // hover. `error` says a write did not land; only this says whether that was
  // the proxy, the disk or a bad path, which is what decides the next move.
  const [reason, setReason] = useState<string | undefined>(undefined);
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
  // The `saves` count of the write `lastWritten` came from, which is how its
  // event places itself against the adopted writes below.
  const lastSent = useRef(0);
  // The same reading as `status === "conflict"`, held where the quiet-period
  // timer can see it: that timer was scheduled by an older render, and the
  // status it closed over is the one from before the conflict.
  const conflicted = useRef(false);
  // How many times the reader has thrown the buffer away, which a write in
  // flight compares against the reading it left with.
  //
  // `pending.current === null` cannot answer that question. A write empties it
  // on the way out and `revert` empties it too, so a write reading it as
  // "nothing newer was typed" would take a revert for the all clear and put the
  // discarded text back in the cache, from where the editor reads it onto the
  // screen. Reverts are counted rather than flagged because a second `:e!`
  // during the same write has to read as another one.
  const reverts = useRef(0);
  // The notes a write is on its way to, counted rather than flagged: `:w`
  // during a quiet write puts two in the air for one note, and the first to
  // answer must not read as the last. By path, because the tail this answers is
  // the note just left: its text is still in flight while this hook has already
  // moved on, and nothing else on the route can see that write.
  const writing = useRef(new Map<string, number>());
  // What the route wrote into this note, by the digest the event will carry and
  // the text the cache will hold. Its own store rather than `lastWritten` and
  // `lastText`, which the hook's own writes overwrite: a bookmark landing
  // between a save and the event that save raises would take the slot, and the
  // editor would then read its own write as somebody else's and lock. Which is
  // the fault this exists to prevent, arrived at from the other side.
  //
  // A list rather than one slot, because one slot needs a promise about how far
  // apart two bookmark writes can be, and nothing here enforces one. In the
  // order `adopt` was called, which is the order the writes landed (the route's
  // `useNoteWrites` queue starts no write before the last one was adopted) and
  // the order the stream reports them: so an event matching one entry says every
  // entry before it is on disk too, its event merged into a later one or lost,
  // and they all go. An entry left behind would take somebody restoring that
  // exact text, a `jj undo` say, for our own write, and the autosave would
  // write over it.
  //
  // The text is there the moment `adopt` is called; the digest waits on
  // `crypto.subtle`, which answers in any order, and is filled in when it does.
  // The route moves the cache straight after adopting, so the editor asks
  // about text before the digest lands, and is answered without waiting.
  // `at` is the `saves` count at adoption, for when our own save's event is
  // the one that says these are gone. `seen` and `failed` are for a digest
  // that never comes, below.
  const adopted = useRef<
    { content: string; digest: string | null; at: number; seen: boolean; failed: boolean }[]
  >([]);
  // Digests of our own writes still on `crypto.subtle`. The stream's question
  // is about a digest, so an event arriving while one is out cannot be told
  // from somebody else's write yet, and is answered once they are all in.
  const hashing = useRef(new Set<Promise<void>>());
  const track = useCallback((landing: Promise<void>) => {
    hashing.current.add(landing);
    // `finally` and not a second handler, so a failure the digest's own handler
    // rethrows still surfaces rather than being swallowed here.
    void landing.finally(() => hashing.current.delete(landing));
  }, []);
  // Events `reconcile` is still deciding about. Each holds the autosave the way
  // a conflict does, because one of them may be somebody else's write, and a
  // save before the answer would overwrite it with no conflict ever shown.
  const holding = useRef(0);
  // Bumped by every write that goes out, so a held event can tell whether `:w`
  // has since overwritten whatever it turns out to be.
  const saves = useRef(0);
  // Bumped each time a note is opened, so a write knows whether the visit it
  // was made in is still the one on screen. The route drops events for every
  // other note, so the event of a write made before the reader left is gone,
  // and a slot or an adopted entry kept past that would take somebody restoring
  // the text for our own write. A visit and not a path, because leaving a note
  // and coming back is the case that loses the event.
  const visit = useRef(0);
  const queryClient = useQueryClient();

  /**
   * Resolves to whether the vault holds the text, so `<leader>q` can refuse.
   *
   * `keepalive` for the write as the page goes away, which the browser would
   * otherwise cancel along with it.
   */
  const write = useCallback(
    (keepalive: boolean): Promise<boolean> => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;

      const content = pending.current;
      // Nothing waiting means disk is already up to date, which counts as saved.
      if (path === undefined || content === null) return Promise.resolve(true);
      pending.current = null;
      // Read before the line below clears it: a flush of a conflicted note that
      // fails is held as conflicted, and reopens as the conflict it was.
      const wasConflicted = conflicted.current;
      // Reaching this at all is the reader deciding to overwrite: the timer stops
      // short of it while the note stands conflicted, and `:w` does not.
      conflicted.current = false;
      saves.current += 1;
      const seq = saves.current;
      const sent = reverts.current;
      setStatus("saving");
      setReason(undefined);
      const to = path;
      const opened = visit.current;
      writing.current.set(to, (writing.current.get(to) ?? 0) + 1);
      // The flush on the way out of a note answers here with that note's
      // closure, after the hook already follows the next one: its slots, its
      // status and its pending text are that one's, and its own event is dropped
      // by the route anyway.
      const here = () => visit.current === opened;

      // Two arguments unless it is the way out, which is the call every other
      // writer of a note makes.
      return (keepalive ? saveNote(path, content, true) : saveNote(path, content)).then(
        (note) => {
          lower(writing.current, to);
          // Unconditionally: a write of this note that landed carried its newest
          // text, which is newer than anything held for it.
          dropText(to);
          // The note that came back and never the text that was sent: the two
          // differ by the `modified` stamp `PUT` writes, so what is on disk is
          // this one. Hashing the other would recognise nothing and read every
          // save of our own as somebody else's write.
          if (here()) lastText.current = note.content;
          track(
            digestOf(note.content).then(
              (digest) => {
                if (!here()) return;
                lastWritten.current = digest;
                lastSent.current = seq;
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
            ),
          );
          // Typing during the write leaves newer text behind us, and that is not
          // saved however this one went. The cache waits on the same test: the
          // editor reloads from it, so writing the text that was in the air would
          // take those newer keystrokes off screen. Reopening a note reads this
          // cache too.
          //
          // A `:e!` during the write is the other way this text stops being the
          // note: the reader asked for the vault's version and got it, and
          // putting this in the cache would hand it straight back to them.
          if (pending.current === null && reverts.current === sent) {
            queryClient.setQueryData(["note", path], note.content);
            if (here()) setStatus("saved");
          }
          return true;
        },
        (failure: unknown) => {
          // At the top of the arm and not at the foot of it: the line below
          // returns early on a write that failed after a `:e!`, and a count
          // lowered under it would leak for the life of the page, leaving that
          // note reading as busy and never written to again.
          lower(writing.current, to);
          const message = failure instanceof Error ? failure.message : String(failure);
          const held = { content, reason: message, conflicted: wasConflicted };
          // The flush of a note already left: `pending` now holds the next note's
          // text, and a retry would write this one's into it. So the text is held
          // for its own note, which takes it back when it is opened again, and
          // the bar lists it meanwhile. Nothing here touches the next note's
          // reading. Ahead of the revert check, because a `:e!` since then was on
          // the next note and threw away that one's text, not this.
          if (!here()) {
            holdText(to, held);
            return false;
          }
          // Nothing to hold and nothing to warn about once the reader has thrown
          // this text away: the buffer holds the vault's version, and the retry
          // would be a retry of an edit that no longer exists anywhere.
          if (reverts.current !== sent) return false;

          // Held as well as kept, because `here()` is also true for the flush
          // as the route unmounts, when this hook is gone and `pending` with it.
          holdText(to, held);
          setStatus("error");
          // Hold on to the text: the next keystroke or `:w` tries again.
          pending.current ??= content;
          setReason(message);
          return false;
        },
      );
    },
    [path, queryClient, track],
  );

  // Of no arguments, because the editor's save key hands its caller the
  // document, which would read here as a `keepalive` asked for.
  const save = useCallback((): Promise<boolean> => write(false), [write]);

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
    (): Promise<boolean> =>
      conflicted.current || holding.current > 0 ? Promise.resolve(false) : save(),
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
   *
   * The count is what a write already in flight reads to find out this
   * happened. The timer needs no cancelling here: it wakes to an empty
   * `pending` and `save` turns straight back round.
   */
  const revert = useCallback(
    (force: boolean): boolean => {
      if (pending.current !== null && !force) return false;

      pending.current = null;
      conflicted.current = false;
      reverts.current += 1;
      // The other way held text ends: the reader chose the vault's.
      if (path !== undefined) dropText(path);
      setStatus("saved");
      setReason(undefined);
      return true;
    },
    [path],
  );

  /**
   * Whether the vault has moved past the buffer, for the keys that must refuse.
   *
   * A reading off the ref rather than off `status`: everything the route builds
   * out of this would take `status` into its dependencies, and one of those is
   * the command table the editor's memo is keyed on. A held event counts: the
   * keys that refuse here go on to flush the buffer over whatever it was.
   */
  const isConflicted = useCallback(() => conflicted.current || holding.current > 0, []);

  /**
   * Whether text for `note` is already on its way to the vault.
   *
   * The map alone, and no reading of `pending`: pending text belongs to the note
   * this hook follows, and the route's own first guard already refuses that note
   * by name, so a clause here would be a second answer to a question already
   * answered.
   */
  const isWriting = useCallback((note: string) => writing.current.has(note), []);

  /**
   * Take a write the route made into `note` as one this hook knows about.
   *
   * A bookmark is a write nobody asked for and nobody can be expected to
   * settle, so the conflict it would otherwise raise is refused here instead.
   * The note is checked against the path of the render this was read in: the
   * route reads `adopt` off a ref every render refreshes, so the question is
   * asked when the `PUT` answers rather than when it started, by which point
   * the reader may have clicked into the note.
   */
  const adopt = useCallback(
    (note: string, content: string) => {
      if (note !== path) return;

      // Pushed now and filled in later, so the list keeps the order of the
      // writes and not the order of their hashes. An entry dropped before its
      // digest lands takes the digest nowhere.
      const entry = {
        content,
        digest: null as string | null,
        at: saves.current,
        seen: false,
        failed: false,
      };
      adopted.current.push(entry);
      track(
        digestOf(content).then(
          (digest) => {
            entry.digest = digest;
          },
          (error: unknown) => {
            // `crypto.subtle` missing outside a secure context, the way the save
            // path reads the same failure. Without a digest no event can ever
            // take the entry away, so the editor's one question about it does:
            // gone now if the editor already asked, gone on its asking if not.
            // The cache notifies on a zero-delay timer and this is a microtask,
            // so either can come first. That text restored later reads as a
            // conflict the reader clears with `:w`.
            if (!(error instanceof TypeError)) throw error;
            if (entry.seen) adopted.current = adopted.current.filter((other) => other !== entry);
            else entry.failed = true;
          },
        ),
      );
    },
    [path, track],
  );

  const change = useCallback(
    (doc: string) => {
      pending.current = doc;
      // Typing settles nothing while the note stands conflicted: the vault
      // still holds text this buffer never saw, and reading `unsaved` would
      // promise a write the timer below no longer makes.
      if (!conflicted.current) setStatus("unsaved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!conflicted.current && holding.current === 0) void save();
      }, QUIET_MS);
    },
    [save],
  );

  /**
   * Take the text held for `note` into the buffer, against the vault's `text`.
   * Answers as `allowReload` would, or undefined when there is nothing to take.
   *
   * Only into a clean buffer with no write in the air, which is what a note
   * just opened looks like. Not while held text is on its way out: the entry
   * stays until the write lands, and that write's echo would take it again.
   * Nothing is written on the take; the bar says why the text is unwritten and
   * `:w` sends it.
   */
  const restore = useCallback((note: string, text: string): boolean | undefined => {
    const held = heldText(note);
    if (!held || pending.current !== null || writing.current.has(note)) return undefined;
    if (sameText(held.content, text)) {
      dropText(note);
      return true;
    }
    pending.current = held.content;
    conflicted.current = held.conflicted;
    setStatus(held.conflicted ? "conflict" : "error");
    setReason(held.reason);
    return false;
  }, []);

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
   *
   * It is also where held text comes back. A note reopened with text held for
   * it opens on that text, and the first thing its editor does is ask about the
   * vault's: this, which runs before the hook's own effect for the new path, so
   * the take cannot wait for that effect.
   */
  const allowReload = useCallback(
    (text: string): boolean => {
      // Before the clean-buffer answer, so an adopted entry with no digest coming
      // is used up by its delivery however the buffer stood when it arrived.
      const entry = adopted.current.find((other) => other.content === text);
      if (entry?.failed) adopted.current = adopted.current.filter((other) => other !== entry);
      else if (entry) entry.seen = true;

      const restored = path === undefined ? undefined : restore(path, text);
      if (restored !== undefined) return restored;

      if (pending.current === null) return true;
      if (text === lastText.current) return false;
      // A write the route made into this note, reaching the editor through the
      // cache. Refused the way our own answer is, and for the same reason: it
      // carries no words the reader has not got.
      // The entry stays unless its digest failed: its event is still to come and
      // has to find it.
      if (entry) return false;

      conflicted.current = true;
      setStatus("conflict");
      return false;
    },
    [path, restore],
  );

  /**
   * Called when the vault reports a write to the open note. Returns whether the
   * caller should reload: false means the buffer is dirty and now conflicted,
   * or the write was this hook's own and there is nothing to do.
   */
  const reconcile = useCallback(
    (digest: string | null): boolean => {
      // Our own write coming back. Every write is reported, this hook's included,
      // and reading one as somebody else's would flag a conflict on every save
      // the typing carried on through. Then a write the route made, coming back
      // off the stream, which takes its entry and every earlier one with it.
      const ours = (of: string): boolean => {
        if (of === lastWritten.current) {
          // An entry adopted before this save went out was adopted when its
          // `PUT` answered, so it was on disk first and its event came first:
          // not seen by now, it is not coming. Dropping one too early costs a
          // conflict the reader clears with `:w`, and keeping one too long can
          // cost somebody's write, which is the worse way to be wrong.
          adopted.current = adopted.current.filter((entry) => entry.at >= lastSent.current);
          return true;
        }
        const at = adopted.current.findIndex((entry) => entry.digest === of);
        if (at === -1) return false;
        adopted.current.splice(0, at + 1);
        return true;
      };
      if (digest !== null && ours(digest)) return false;
      if (pending.current === null) return true;

      // Nothing is discarded and nothing is written. The buffer keeps the
      // reader's text, the vault keeps the other writer's, and `:w` is how the
      // reader says which one wins.
      const conflict = () => {
        conflicted.current = true;
        setStatus("conflict");
      };
      if (digest === null || hashing.current.size === 0) {
        conflict();
        return false;
      }
      // One of our digests is still out and may be this one, so the autosave is
      // held until it is in. A `:w` or a `:e!` in the meantime settled it the
      // way a conflict would have been settled, so there is nothing to flag.
      holding.current += 1;
      const at = saves.current;
      void Promise.allSettled(hashing.current).then(() => {
        holding.current -= 1;
        if (!ours(digest)) {
          if (saves.current === at && pending.current !== null) conflict();
          return;
        }
        // Ours after all: carry on with the write the hold kept back.
        if (holding.current > 0 || conflicted.current || pending.current === null) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          if (!conflicted.current && holding.current === 0) void save();
        }, QUIET_MS);
      });
      return false;
    },
    [save],
  );

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

  // A reload or a closed tab unmounts nothing, so the flush above never runs
  // for them, and the quiet period's text goes with the page. A phone sending
  // the app to the background fires no `pagehide` at all, only the
  // visibility change, and may never come back to fire anything else.
  //
  // The text is held before anything is sent: a keepalive write can still be
  // refused (over 64 KiB, or no network) with nobody left to hear it, and the
  // held copy is what the next opening offers. A landed write drops it, and
  // one that landed after the page was gone is recognised then by `sameText`.
  // A conflicted note, or one with an event still being placed, is held and
  // not written: unlike leaving a note, nothing has to be decided now, and the
  // reader can decide on return.
  useEffect(() => {
    if (path === undefined) return;
    const hide = () => {
      if (pending.current === null) return;
      const stop = conflicted.current || holding.current > 0;
      holdText(path, {
        content: pending.current,
        reason: "Not yet written when the page was hidden",
        conflicted: conflicted.current,
      });
      if (!stop) void write(true);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") hide();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [path, write]);

  // The flush above still counts as the visit it leaves: React runs the old
  // render's cleanups before any of the new render's setups.
  // Runs on each opening: `queryClient` and `restore` never change.
  useEffect(() => {
    visit.current += 1;
    adopted.current = [];
    lastText.current = null;
    lastWritten.current = null;
    // A note whose editor stayed mounted while the focus was in another pane
    // asks nothing on the way back, so `allowReload` never sees its held text.
    // Taken here against the note the cache holds, which is what that editor
    // was opened on. With nothing cached the editor is still to mount, and
    // will ask; one that just mounted has asked already, and `pending` says so.
    const cached =
      path === undefined ? undefined : queryClient.getQueryData<string>(["note", path]);
    if (path !== undefined && cached !== undefined) restore(path, cached);
    // The flush of the note left set `saving` on its way out and never answers
    // here, so the reading starts again for the note opened, unless it holds
    // text just taken.
    if (pending.current === null) {
      setStatus("saved");
      setReason(undefined);
    }
  }, [path, queryClient, restore]);

  return {
    status,
    reason,
    change,
    save,
    saveFirst,
    revert,
    isConflicted,
    isWriting,
    adopt,
    allowReload,
    reconcile,
  };
}
