import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChangedOnDisk, type Note, saveNote } from "@/lib/api";
import {
  dropText,
  type Held,
  heldText,
  holdText,
  movedTo,
  movesMade,
  sameText,
  unstamped,
} from "@/lib/held-text";
import { digestOf } from "@/lib/vault-events";

/** Long enough that a sentence is one write, short enough to forget about. */
const QUIET_MS = 800;

/**
 * A note left with a failed write has no reading of its own here: its text is
 * held (`held-text.ts`) and the bar lists it beside whatever note is open.
 */
export type SaveStatus = "saved" | "unsaved" | "saving" | "error" | "conflict";

/**
 * The base a save names for `text`: its sha256 with `modified` set aside, the
 * way the backend hashes the note on disk. None where `crypto.subtle` is
 * missing, a proxy serving plain http, and the write lands as it did before.
 */
async function baseOf(text: string): Promise<string | undefined> {
  try {
    return await digestOf(unstamped(text));
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return undefined;
  }
}

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
 *
 * `shown` reads the document the focused editor has on screen, or undefined
 * when there is none. See the effect run on each opening.
 */
export function useAutosave(path: string | undefined, shown?: () => string | undefined) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  // Read in an effect and never a dependency: the route builds a new one per
  // pane, and the effect it is read in must run on a new path and nothing else.
  const shownRef = useRef(shown);
  shownRef.current = shown;
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
  // The vault's text under the buffer as this visit last learned it: our last
  // write, a reload taken in, a route write adopted. What a save names as its
  // base. Apart from `lastText`, which a restored bookmark must not match.
  const onDisk = useRef<string | null>(null);
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
  // The last text sent to each note while any write to it is in the air. A
  // write empties `pending` as it goes out, and a plain fetch is cancelled with
  // the page, so this is the only copy a hide can find of a quiet write's text.
  const inAir = useRef(new Map<string, string>());
  // The last write to each note still to answer, resolving with the text on
  // disk once it has, as far as this hook knows. The next write to that note
  // goes out behind it and names that text as its base: not the text the last
  // one sent, which `stamp` may have given a block, and which a write that
  // failed never put there. Only within the visit that made it: a flush from
  // the visit before lands text the buffer reopened without, and naming it
  // would let this buffer over it unasked.
  const queued = useRef(new Map<string, { link: Promise<string | undefined>; visit: number }>());
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
  // The held entry the buffer holds, by identity, and the same as state for
  // the bar, which lists the open note's held text only while it is not on
  // screen. Identity rather than path: a flush that fails after its note was
  // reopened holds a second entry the buffer never saw, and a save of the
  // buffer must not take that one with it.
  const taken = useRef<Held | null>(null);
  const [restored, setRestored] = useState(false);
  // The `saves` count when this hook held each entry, so a failing write can
  // tell an entry held after it went out (newer text, the hide's) from one it
  // may replace. In memory: the store keeps an unchanged entry's object.
  const heldAt = useRef(new WeakMap<Held, number>());
  const take = useCallback((entry: Held | null) => {
    taken.current = entry;
    setRestored(entry !== null);
  }, []);
  // Whether this visit's own effect is still to run, and the entry held for the
  // note when it did. Held text is offered once, at opening: an entry held
  // later came from a flush that failed after the editor had already opened on
  // the vault's text, and taking it then would put text in `pending` that the
  // buffer does not show.
  const opening = useRef(true);
  const offered = useRef<Held | undefined>(undefined);
  const queryClient = useQueryClient();

  /**
   * The vault's text under the buffer of `note`, the note open now: what this
   * visit last learned is on disk, the cache otherwise. Not the cache alone,
   * which a write is kept out of while typing went on through it.
   */
  const lastBase = useCallback(
    (note: string) => onDisk.current ?? queryClient.getQueryData<string>(["note", note]),
    [queryClient],
  );

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
      inAir.current.set(to, content);
      const answered = () => {
        lower(writing.current, to);
        if (!writing.current.has(to)) inAir.current.delete(to);
      };
      // The flush on the way out of a note answers here with that note's
      // closure, after the hook already follows the next one: its slots, its
      // status and its pending text are that one's, and its own event is dropped
      // by the route anyway.
      const here = () => visit.current === opened;
      // The held entry this write carries, read now and not at the answer: a
      // flush on leaving answers after the visit, and with it `taken`, is gone,
      // and an entry held while this was in the air is newer text it never
      // carried.
      const carried = taken.current;
      // What the vault held under the buffer, which a held copy of this text
      // keeps to tell on reopening whether somebody else wrote the note since.
      const base = lastBase(to);
      // Held text is kept by path, and the note may move before this answers.
      const since = movesMade();

      // Named so that a vault moved past the text under the buffer refuses. No
      // base for the overwrite `:w` makes of a conflict, and none on the way
      // out, whose hash would take a task the page going away may never run.
      // Two arguments unless it is the way out or names a base, which is the
      // call every other writer of a note makes.
      const send = (under: string | undefined): Promise<Note> =>
        under === undefined || wasConflicted
          ? saveNote(to, content)
          : baseOf(under).then((hash) =>
              hash === undefined ? saveNote(to, content) : saveNote(to, content, false, hash),
            );
      let request: Promise<Note>;
      if (keepalive) request = saveNote(path, content, true);
      else {
        const queue = queued.current.get(to);
        const before = queue?.link;
        const own = lastBase(to);
        const under = queue?.visit === opened ? queue.link : Promise.resolve(own);
        request = before === undefined ? send(own) : before.then(() => under).then(send);
        // Never rejects, so a failed write still lets the next one go: the vault
        // did not move, as far as this hook knows.
        const link = request.then(
          (note) => note.content,
          () => under,
        );
        queued.current.set(to, { link, visit: opened });
        void link.then(() => {
          if (queued.current.get(to)?.link === link) queued.current.delete(to);
        });
      }
      return request.then(
        (note) => {
          answered();
          // The held entry goes when this write carried it: its own text, or
          // text typed on top of the entry the buffer had taken when this was
          // sent. An entry the buffer never showed, held by a flush that failed
          // after the note was reopened, is still nowhere else, and stays; so
          // does one held while this was in the air.
          const now = movedTo(to, since);
          const entry = heldText(now);
          if (entry && (entry.content === content || (carried !== null && entry === carried))) {
            dropText(now);
          }
          // What the buffer took is written now, so nothing on screen is held
          // text any more, and a second entry, if any, goes on the bar. Not when
          // the buffer took newer text since. An entry a hide held of this very
          // text while it was in the air is written now too.
          if (here() && (taken.current === carried || taken.current?.content === content)) {
            take(null);
          }
          // The note that came back and never the text that was sent: the two
          // differ by the `modified` stamp `PUT` writes, so what is on disk is
          // this one. Hashing the other would recognise nothing and read every
          // save of our own as somebody else's write.
          if (here()) {
            lastText.current = note.content;
            onDisk.current = note.content;
          }
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
          answered();
          const message = failure instanceof Error ? failure.message : String(failure);
          // Somebody else wrote the note since the base this named, and the
          // vault kept their text: a conflict, which only `:w` settles.
          const refused = failure instanceof ChangedOnDisk;
          const held = { content, reason: message, conflicted: wasConflicted || refused, base };
          // An entry held after this went out holds newer text, the hide's,
          // which is on screen and on its own way out: this older text replaces
          // neither it nor `pending`. An entry of this same text is the hide
          // holding this write while it was in the air, and is its own.
          const now = movedTo(to, since);
          const existing = heldText(now);
          const newer = existing && existing.content !== content;
          if (newer && (heldAt.current.get(existing) ?? -1) >= seq) return false;
          // Its own send count: a write sent after this one and failing first
          // holds newer text, which this must not replace either.
          heldAt.current.set(held, seq);
          // The flush of a note already left: `pending` now holds the next note's
          // text, and a retry would write this one's into it. So the text is held
          // for its own note, which takes it back when it is opened again, and
          // the bar lists it meanwhile. Nothing here touches the next note's
          // reading. Ahead of the revert check, because a `:e!` since then was on
          // the next note and threw away that one's text, not this.
          if (!here()) {
            holdText(now, held);
            return false;
          }
          // Nothing to hold and nothing to warn about once the reader has thrown
          // this text away: the buffer holds the vault's version, and the retry
          // would be a retry of an edit that no longer exists anywhere.
          if (reverts.current !== sent) return false;

          // Held as well as kept, because `here()` is also true for the flush
          // as the route unmounts, when this hook is gone and `pending` with it.
          holdText(now, held);
          // Refused after the other writer's event found nothing waiting and the
          // editor took their text in: this text is on screen nowhere, so it is
          // only held, for the bar to list and the next opening to offer. Kept
          // in `pending`, `:w` would send it unseen.
          const doc = shownRef.current?.();
          if (refused && pending.current === null && doc !== undefined && !sameText(doc, content)) {
            setStatus("saved");
            return false;
          }
          // The buffer holds this text, so it is the entry the bar leaves out.
          take(held);
          conflicted.current ||= refused;
          setStatus(refused ? "conflict" : "error");
          // Hold on to the text: the next keystroke or `:w` tries again, or
          // only `:w` when the vault refused it.
          pending.current ??= content;
          setReason(message);
          return false;
        },
      );
    },
    [path, queryClient, track, take, lastBase],
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
      // The caller put the vault's text in the cache before asking, and that is
      // what the buffer holds now, not the last write of this visit.
      onDisk.current = null;
      // The other way held text ends: the reader chose the vault's. A write
      // still in the air carries text thrown away too, which a hide must not
      // hold or send again.
      if (path !== undefined) {
        dropText(path);
        inAir.current.delete(path);
      }
      take(null);
      setStatus("saved");
      setReason(undefined);
      return true;
    },
    [path, take],
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
      // On disk under the buffer now, so the next save names it.
      onDisk.current = content;

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
   * `:w` sends it. Once the opening is over, only the entry held at opening.
   */
  const restore = useCallback(
    (note: string, text: string): boolean | undefined => {
      const held = heldText(note);
      if (!held || pending.current !== null || writing.current.has(note)) return undefined;
      if (!opening.current && held !== offered.current) return undefined;
      if (sameText(held.content, text)) {
        dropText(note);
        onDisk.current = text;
        return true;
      }
      pending.current = held.content;
      take(held);
      // A vault moved past the text the buffer was based on is somebody
      // else's write since, and the held text must not go over it unasked.
      const moved = held.base !== undefined && !sameText(held.base, text);
      conflicted.current = held.conflicted || moved;
      setStatus(conflicted.current ? "conflict" : "error");
      setReason(held.reason);
      return false;
    },
    [take],
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

      // Taken into the buffer, so the vault under it is this text now, and the
      // next write names it as its base. Not our last write any more: the
      // vault moved on, and a base naming the old text would be refused.
      if (pending.current === null) {
        onDisk.current = text;
        return true;
      }
      // The vault holds what the buffer holds, whoever wrote it there, so
      // nothing is left to write or to settle: a conflict over it, or a held
      // entry of it, is over. Yes, so the reload brings the `modified` stamp
      // onto the screen. Only that entry goes: one held by a flush that failed
      // after the reopen holds text the buffer never showed, kept as `write`
      // keeps it.
      if (sameText(text, pending.current)) {
        onDisk.current = text;
        pending.current = null;
        conflicted.current = false;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        const entry = path === undefined ? undefined : heldText(path);
        if (
          path !== undefined &&
          entry &&
          (entry === taken.current || sameText(entry.content, text))
        ) {
          dropText(path);
        }
        take(null);
        setStatus("saved");
        setReason(undefined);
        return true;
      }
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
    [path, restore, take],
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
      const held = visit.current;
      void Promise.allSettled(hashing.current).then(() => {
        // The note was left meanwhile, and the leave settled this event: it held
        // any text as conflicted, and the opening let go of the hold. What is
        // in `pending` now is the next note's, which an answer about this one
        // must neither conflict nor send through this `save`.
        if (visit.current !== held) return;
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
  // A conflicted note is held and not written, the way the hide below holds
  // it: flushing would put the reader's text over the other writer's with
  // nobody asked, and only `:w` gets to make that call. An event still being
  // placed counts, since it may be somebody else's write, and its entry is
  // marked conflicted all the same so the next opening shows the conflict and
  // waits for the reader. The held store is then the only copy of the text.
  // `write` would clear `pending` and the flag on its way out; nothing goes
  // out here, so they are cleared by hand, or the next note inherits them:
  // `restore` refuses while `pending` is set, and so does the opening's reset
  // of the status. A cleanup re-run on a new `path` is exactly the leave.
  useEffect(
    () => () => {
      const stop = conflicted.current || holding.current > 0;
      if (path === undefined || pending.current === null || !stop) {
        void save();
      } else {
        const entry = {
          content: pending.current,
          reason: "Changed on disk before the note was left",
          conflicted: true,
          base: lastBase(path),
        };
        // Counted as the write the flush would have been: an event held for
        // this note settles later against `saves`, and an unchanged count
        // would let it mark the next note's pending text conflicted.
        saves.current += 1;
        holdText(path, entry);
        heldAt.current.set(entry, saves.current);
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        pending.current = null;
        conflicted.current = false;
      }
      // The next visit offers held text afresh, and its buffer holds none yet.
      opening.current = true;
      take(null);
    },
    [path, save, take, lastBase],
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
  // not written, as on leaving: the reader decides on return.
  //
  // Held text reopened and not touched since is left as it is: the reader has
  // not said to write it, and the entry already holds it, with the reason the
  // vault gave.
  useEffect(() => {
    if (path === undefined) return;
    const hide = () => {
      // Nothing waiting, but a quiet write may still be in the air, and the page
      // going away cancels it. Its text is held and sent again with keepalive,
      // and the quiet write landing after all drops the held copy.
      const content = pending.current ?? inAir.current.get(path);
      if (content === undefined) return;
      if (content === taken.current?.content) return;
      const stop = conflicted.current || holding.current > 0;
      const entry = {
        content,
        reason: "Not yet written when the page was hidden",
        conflicted: conflicted.current,
        base: lastBase(path),
      };
      holdText(path, entry);
      // After every write already in the air, which a failing one reads.
      heldAt.current.set(entry, saves.current);
      take(entry);
      if (stop) return;
      // In `pending` only to be sent: a held in-flight text put there would
      // outlive its own write landing, and leave the note reading unsaved.
      pending.current = content;
      void write(true);
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
  }, [path, write, take, lastBase]);

  // The flush above still counts as the visit it leaves: React runs the old
  // render's cleanups before any of the new render's setups.
  // Runs on each opening: `queryClient` and `restore` never change.
  useEffect(() => {
    visit.current += 1;
    // The leave has read the holds already; each one settles against the visit
    // it was made in, and the note opened now has none.
    holding.current = 0;
    adopted.current = [];
    lastText.current = null;
    onDisk.current = null;
    lastWritten.current = null;
    // A note whose editor stayed mounted while the focus was in another pane
    // asks nothing on the way back, so `allowReload` never sees its held text.
    // Taken here against the note the cache holds, and only when that editor
    // has the held text on screen: a second pane holding the note that never
    // showed it has the vault's text, and taking the held text into `pending`
    // there would send the vault's text plus a keystroke and drop the entry.
    // Left held instead, the bar lists it. With nothing cached the editor is
    // still to mount, and will ask; one that just mounted has asked already,
    // and `pending` says so.
    const cached =
      path === undefined ? undefined : queryClient.getQueryData<string>(["note", path]);
    const held = path === undefined ? undefined : heldText(path);
    const doc = shownRef.current?.();
    if (path !== undefined && cached !== undefined && held && doc !== undefined) {
      if (sameText(doc, held.content)) restore(path, cached);
    }
    // An editor still to mount opens on the entry held now, and only that one
    // is taken when it asks. See `opening`. An editor already showing other
    // text never takes it this visit: a later reload would put it in `pending`
    // under a screen that does not show it.
    const shownOther = doc !== undefined && held !== undefined && !sameText(doc, held.content);
    offered.current = path === undefined || shownOther ? undefined : heldText(path);
    opening.current = false;
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
    restored,
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
