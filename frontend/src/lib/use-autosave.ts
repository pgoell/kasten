import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChangedOnDisk, type Note, saveNote } from "@/lib/api";
import {
  dropText,
  type Held,
  heldText,
  heldTexts,
  holdText,
  landedAs,
  movedTo,
  movesMade,
  sameText,
} from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";

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
 * Every write names its base, the vault's text under the buffer, and the vault
 * refuses one it has moved past. That refusal is the only conflict check: the
 * client guesses nothing about whose write an event was. A refused note stops
 * the automatic write, and the reader breaks the tie with `:w`.
 *
 * `shown` reads the document the focused editor has on screen, or undefined
 * when there is none. See the effect run on each opening.
 *
 * `pane` names the focused pane. One hook follows whichever pane has the
 * focus, and two panes on one note hold two buffers: a move between them is
 * a leave and an opening, as a move to another note is, or the second pane's
 * typing would replace the first's text in `pending` and drop held text the
 * first showed as written.
 */
export function useAutosave(
  path: string | undefined,
  shown?: () => string | undefined,
  pane?: string,
) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  // Read in an effect and never a dependency: the route builds a new one per
  // render, and the effect it is read in must run on an opening and nothing
  // else.
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
  // The vault's text under the buffer as this visit last learned it: our last
  // write's answer, a reload taken into a clean buffer, held text found landed.
  // What a save names as its base.
  const onDisk = useRef<string | null>(null);
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
  // How many times a clean buffer took the vault's text in, which a failing
  // write compares against the reading it left with: after one, the screen
  // holds text not typed on the write's (#290).
  const reloads = useRef(0);
  // The notes a write is on its way to, counted rather than flagged: `:w`
  // during a quiet write puts two in the air for one note, and the first to
  // answer must not read as the last. By path, because the tail this answers is
  // the note just left: its text is still in flight while this hook has already
  // moved on, and nothing else on the route can see that write.
  const writing = useRef(new Map<string, number>());
  // The last text sent to each note while any write to it is in the air. A
  // write empties `pending` as it goes out, and a plain fetch is cancelled with
  // the page, so this is the only copy a hide can find of a quiet write's text.
  // With the `reloads` count it left with: after a reload, text typed on is
  // typed on the reload's text, and not on this.
  const inAir = useRef(new Map<string, { content: string; loaded: number }>());
  // The last write to each note still to answer, resolving with the text on
  // disk once it has, as far as this hook knows. The next write to that note
  // goes out behind it and names that text as its base: not the text the last
  // one sent, which `stamp` may have given a block, and which a write that
  // failed never put there. Only within the visit that made it: a flush from
  // the visit before lands text the buffer reopened without, and naming it
  // would let this buffer over it unasked. Nor after a reload into the clean
  // buffer since it went out: the next write was typed on the reload's text,
  // and still goes out behind it, but names that text (#298).
  const queued = useRef(
    new Map<string, { link: Promise<string | undefined>; visit: number; loaded: number }>(),
  );
  // The notes whose outside write `reconcile` declined while a write to them
  // was in the air, reloaded once the last of those writes answers (#296).
  const missed = useRef(new Set<string>());
  // Bumped by every write that goes out, which orders held entries against
  // the writes that fail after them (`heldAt`).
  const saves = useRef(0);
  // Bumped each time a note is opened, so a write knows whether the visit it
  // was made in is still the one on screen.
  const visit = useRef(0);
  // The held entry the buffer holds, by identity, and the same as state for
  // the bar, which leaves out that entry alone while it is on screen.
  // Identity rather than path: a flush that fails after its note was reopened
  // holds a second entry the buffer never saw, and a save of the buffer must
  // not take that one with it.
  const taken = useRef<Held | null>(null);
  const [restored, setRestored] = useState<Held | null>(null);
  // The `saves` count and the visit when this hook held each entry, so a
  // failing write can tell an entry held after it went out on the same buffer
  // (newer text, the hide's) from one typed on other text. In memory: the
  // store keeps an unchanged entry's object.
  const heldAt = useRef(new WeakMap<Held, { seq: number; visit: number }>());
  const take = useCallback((entry: Held | null) => {
    taken.current = entry;
    setRestored(entry);
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
      const loaded = reloads.current;
      setStatus("saving");
      setReason(undefined);
      const to = path;
      const opened = visit.current;
      // Read before the line below replaces it: the keepalive names the write
      // still in the air, which lands first and is what it finds on disk. Not
      // once a reload came between: this text was typed on the reload's.
      const air = inAir.current.get(to);
      const before = air?.loaded === loaded ? air.content : undefined;
      writing.current.set(to, (writing.current.get(to) ?? 0) + 1);
      inAir.current.set(to, { content, loaded });
      const answered = () => {
        lower(writing.current, to);
        if (writing.current.has(to)) return;
        inAir.current.delete(to);
        // An outside write declined while this was in the air is read now,
        // once nothing of ours can land over it. The refetch answers later, so
        // the arm below settles this write before the editor asks.
        if (missed.current.delete(to)) {
          void queryClient.invalidateQueries({ queryKey: ["note", to] }, { cancelRefetch: false });
        }
      };
      // The flush on the way out of a note answers here with that note's
      // closure, after the hook already follows the next one: its slots, its
      // status and its pending text are that one's.
      const here = () => visit.current === opened;
      // The held entry this write carries, read now and not at the answer: a
      // flush on leaving answers after the visit, and with it `taken`, is gone,
      // and an entry held while this was in the air is newer text it never
      // carried.
      const carried = taken.current;
      // What the vault held under the buffer as far as this visit knows now,
      // which a held copy of this text keeps to tell on reopening whether
      // somebody else wrote the note since.
      const base = lastBase(to);
      // The text the request names, kept beside `base` when it differs. Set as
      // the request goes out: a write queued behind another names what that
      // one landed, not what the buffer was on when this was asked for.
      let named = base;
      // Held text is kept by path, and the note may move before this answers.
      const since = movesMade();

      // No base for the overwrite `:w` makes of a conflict. Two arguments
      // unless it names one, which is the call every other writer makes.
      const send = (under: string | undefined): Promise<Note> => {
        named = under;
        return under === undefined || wasConflicted
          ? saveNote(to, content)
          : saveNote(to, content, false, noteBase(under));
      };
      let request: Promise<Note>;
      if (keepalive) {
        // Named too, so a page going away cannot write over somebody else.
        // Text typed behind a write in the air names that write, which left
        // first and lands first. The same text as that write names its base:
        // it lands if the page cancelled that write, and is the server's no-op
        // if it landed.
        const under = before !== undefined && before !== content ? before : base;
        named = under;
        request =
          under === undefined
            ? saveNote(to, content, true)
            : saveNote(to, content, true, noteBase(under));
      } else {
        const queue = queued.current.get(to);
        const under =
          queue?.visit === opened && queue.loaded === loaded ? queue.link : Promise.resolve(base);
        request = queue === undefined ? send(base) : queue.link.then(() => under).then(send);
        // Never rejects, so a failed write still lets the next one go: the vault
        // did not move, as far as this hook knows.
        const link = request.then(
          (note) => note.content,
          () => under,
        );
        queued.current.set(to, { link, visit: opened, loaded });
        void link.then(() => {
          if (queued.current.get(to)?.link === link) queued.current.delete(to);
        });
      }
      return request.then(
        (note) => {
          answered();
          // A held entry goes when this write carried it: its own text, or
          // text typed on top of the entry the buffer had taken when this was
          // sent. An entry the buffer never showed, held by a flush that failed
          // after the note was reopened, is still nowhere else, and stays; so
          // does one held while this was in the air.
          const now = movedTo(to, since);
          for (const entry of heldTexts(now)) {
            if (
              entry === carried ||
              entry.content === content ||
              landedAs(entry.content, note.content)
            ) {
              dropText(now, entry);
            }
          }
          // What the buffer took is written now, so nothing on screen is held
          // text any more, and a second entry, if any, goes on the bar. Not when
          // the buffer took newer text since. An entry a hide held of this very
          // text while it was in the air is written now too.
          if (here() && (taken.current === carried || taken.current?.content === content)) {
            take(null);
          }
          // The note that came back and never the text that was sent: the two
          // differ by the `modified` stamp `PUT` writes, and the next save names
          // what is on disk. Not after a reload since this went out: the
          // reload's text came after this answer on disk, and the buffer was
          // typed on it, so the next save names that (#298).
          if (here() && reloads.current === loaded) onDisk.current = note.content;
          // Typing during the write leaves newer text behind us, and that is not
          // saved however this one went. The cache waits on the same test: the
          // editor reloads from it, so writing the text that was in the air would
          // take those newer keystrokes off screen. Reopening a note reads this
          // cache too.
          //
          // A `:e!` during the write is the other way this text stops being the
          // note: the reader asked for the vault's version and got it, and
          // putting this in the cache would hand it straight back to them.
          //
          // So is a later write still in the air (#296): `pending` is empty
          // because that one took its text, and this answer on screen would
          // replace it there, and the keys typed next would go onto it. That
          // write's own answer is the one the cache wants. Counted for this
          // note alone: `answered` has already taken this write off.
          if (pending.current === null && reverts.current === sent && !writing.current.has(to)) {
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
          const held = {
            content,
            reason: message,
            conflicted: wasConflicted || refused,
            base,
            after: named === base ? undefined : named,
          };
          // An entry held after this went out, on this visit's buffer, holds
          // newer text typed on top of this, the hide's, which is on screen
          // and on its own way out: this older text is dropped, and goes into
          // neither the store nor `pending`. An entry of this same text is the
          // hide holding this write while it was in the air, and is its own.
          // One held on another visit was typed on other text, and stays
          // beside this.
          const now = movedTo(to, since);
          const newer = heldTexts(now).some((entry) => {
            const at = heldAt.current.get(entry);
            return entry.content !== content && at?.visit === opened && at.seq >= seq;
          });
          // Not once the buffer took other text since this went out: the hide's
          // entry was typed on that, not on this, and this text is on screen
          // nowhere and held nowhere else (#297).
          if (newer && reloads.current === loaded) return false;
          // Its own send count: a write sent after this one and failing first
          // holds newer text, which this must not replace either.
          heldAt.current.set(held, { seq, visit: opened });
          // The flush of a note already left: `pending` now holds the next note's
          // text, and a retry would write this one's into it. So the text is held
          // for its own note, which takes it back when it is opened again, and
          // the bar lists it meanwhile. Nothing here touches the next note's
          // reading. Ahead of the revert check, because a `:e!` since then was on
          // the next note and threw away that one's text, not this.
          if (!here()) {
            holdText(now, held, carried);
            return false;
          }
          // Nothing to hold and nothing to warn about once the reader has thrown
          // this text away: the buffer holds the vault's version, and the retry
          // would be a retry of an edit that no longer exists anywhere.
          if (reverts.current !== sent) return false;
          // A write that went out after this one on this visit carries text
          // typed on top of this, which is on screen and on its own way out
          // (#290). This older text goes into neither the store nor `pending`:
          // kept in `pending`, a leave or `:w` would write it over the newer.
          // Not when the buffer took other text since: the later write was
          // typed on that, and this text is on screen nowhere.
          if (saves.current !== seq && reloads.current === loaded) return false;

          // Held as well as kept, because `here()` is also true for the flush
          // as the route unmounts, when this hook is gone and `pending` with it.
          // In the place of the entry this was typed on, and of no other.
          holdText(now, held, carried);
          // Failed, refused or not, after the editor took other text into a clean
          // buffer: somebody's write since, or the vault's text read back. This
          // text is on screen nowhere, so it is only held, for the bar to list
          // and the next opening to offer. Kept in `pending`, `:w` would send it
          // unseen; taken, a save of what the screen shows would drop it as
          // carried (#290). Counted as well as compared: text typed on top of
          // the reload no longer reads as either.
          const doc = shownRef.current?.();
          const elsewhere =
            reloads.current !== loaded ||
            (pending.current === null && doc !== undefined && !sameText(doc, content));
          if (elsewhere) {
            if (pending.current === null && !writing.current.has(to)) setStatus("saved");
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
    [path, queryClient, take, lastBase],
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
   *
   * The count is what a write already in flight reads to find out this
   * happened. The timer needs no cancelling here: it wakes to an empty
   * `pending` and `save` turns straight back round.
   */
  const revert = useCallback(
    (force: boolean): boolean => {
      // A write in the air counts as unwritten text too (#291): `write` empties
      // `pending` as it goes out, and once thrown away here its failure would
      // hold nothing.
      const busy = path !== undefined && writing.current.has(path);
      if ((pending.current !== null || busy) && !force) return false;

      pending.current = null;
      conflicted.current = false;
      reverts.current += 1;
      // The caller put the vault's text in the cache before asking, and that is
      // what the buffer holds now. Kept here and not read off the cache later,
      // which a route write's refetch moves under a buffer that declined it.
      onDisk.current =
        path === undefined ? null : (queryClient.getQueryData<string>(["note", path]) ?? null);
      // The other way held text ends: the reader chose the vault's. A write
      // still in the air carries text thrown away too, which a hide must not
      // hold or send again.
      // Only the entry on screen: one the buffer never showed was not looked
      // at, let alone thrown away.
      if (path !== undefined) {
        if (taken.current) dropText(path, taken.current);
        inAir.current.delete(path);
      }
      take(null);
      setStatus("saved");
      setReason(undefined);
      return true;
    },
    [path, take, queryClient],
  );

  /**
   * Whether the vault has moved past the buffer, for the keys that must refuse.
   *
   * A reading off the ref rather than off `status`: everything the route builds
   * out of this would take `status` into its dependencies, and one of those is
   * the command table the editor's memo is keyed on.
   */
  const isConflicted = useCallback(() => conflicted.current, []);

  /**
   * Whether text for `note` is already on its way to the vault.
   *
   * The map alone, and no reading of `pending`: pending text belongs to the note
   * this hook follows, and the route's own first guard already refuses that note
   * by name, so a clause here would be a second answer to a question already
   * answered.
   */
  const isWriting = useCallback((note: string) => writing.current.has(note), []);

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
   * Take the text held for `note` into the buffer, against the vault's `text`.
   * Answers as `allowReload` would, or undefined when there is nothing to take.
   *
   * Only into a clean buffer with no write in the air, which is what a note
   * just opened looks like. Not while held text is on its way out: the entry
   * stays until the write lands, and that write's echo would take it again.
   * Nothing is written on the take; the bar says why the text is unwritten and
   * `:w` sends it. Once the opening is over, only the entry held at opening.
   * Only an entry typed into the note `text` is, too: another note's, left at
   * this path, stays held and listed (`heldText`).
   */
  const restore = useCallback(
    (note: string, text: string): boolean | undefined => {
      const held = heldText(note, text);
      if (!held || pending.current !== null || writing.current.has(note)) return undefined;
      if (!opening.current && held !== offered.current) return undefined;
      // Every entry the vault holds by now has landed, whichever write it was.
      for (const entry of heldTexts(note)) {
        if (landedAs(entry.content, text)) dropText(note, entry);
      }
      // The editor opened on the note's oldest, so only that one can be taken.
      // When it landed, the next waits on the bar for the next opening.
      if (landedAs(held.content, text)) {
        onDisk.current = text;
        return true;
      }
      // The editor opened before the vault's text came, on the oldest entry of
      // all, and that one belongs to another note. Taken, this entry would sit
      // in `pending` under a screen that does not show it. So the editor takes
      // the vault's text, and the entry waits for the next opening.
      const doc = shownRef.current?.();
      if (doc !== undefined && !sameText(doc, held.content)) {
        onDisk.current = text;
        return true;
      }
      pending.current = held.content;
      take(held);
      // A vault moved past the text the buffer was based on is somebody
      // else's write since, and the held text must not go over it unasked.
      // `landedAs`, because `after` is text a write sent, which the vault
      // then stamped.
      const moved =
        held.base !== undefined &&
        !landedAs(held.base, text) &&
        !(held.after !== undefined && landedAs(held.after, text));
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
   * job. A buffer with text in it takes nothing and raises nothing, whoever
   * wrote `text`: our own answer a keystroke late, or somebody else. The next
   * save names the base the buffer was typed on, and the vault answers which.
   *
   * It is also where held text comes back. A note reopened with text held for
   * it opens on that text, and the first thing its editor does is ask about the
   * vault's: this, which runs before the hook's own effect for the new path, so
   * the take cannot wait for that effect.
   */
  const allowReload = useCallback(
    (text: string): boolean => {
      const restored = path === undefined ? undefined : restore(path, text);
      if (restored !== undefined) return restored;

      // Taken into the buffer, so the vault under it is this text now, and the
      // next write names it as its base.
      if (pending.current === null) {
        onDisk.current = text;
        // Only text the screen lacks: the editor asks with the text it already
        // shows as well, and that replaces nothing.
        const doc = shownRef.current?.();
        if (doc !== undefined && !sameText(doc, text)) reloads.current += 1;
        return true;
      }
      // The vault holds what the buffer holds, whoever wrote it there, so
      // nothing is left to write or to settle: a conflict over it, or a held
      // entry of it, is over. Yes, so the reload brings the stamp onto the
      // screen. Only that entry goes: one held by a flush that failed after
      // the reopen holds text the buffer never showed, kept as `write` keeps it.
      if (landedAs(pending.current, text)) {
        onDisk.current = text;
        pending.current = null;
        conflicted.current = false;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        if (path !== undefined) {
          for (const entry of heldTexts(path)) {
            if (entry === taken.current || landedAs(entry.content, text)) dropText(path, entry);
          }
        }
        take(null);
        setStatus("saved");
        setReason(undefined);
        return true;
      }
      return false;
    },
    [path, restore, take],
  );

  /**
   * Called when the vault reports a write to the open note. Answers whether the
   * caller should reload: yes for a clean buffer, no for a dirty one, which
   * keeps the reader's text and marks nothing. Its next save names its base,
   * and the vault refuses it if the write was somebody else's.
   *
   * No while a write to the note is in the air, too (#296): its answer may
   * still come back older than the text the event reports, or be the event
   * itself, a step behind a write queued after it. The note is reloaded once
   * its last write answers instead.
   */
  const reconcile = useCallback((): boolean => {
    if (path !== undefined && writing.current.has(path)) {
      missed.current.add(path);
      return false;
    }
    return pending.current === null;
  }, [path]);

  // React runs a cleanup with the render's own closure, so opening another
  // note writes what is pending to the note it was typed into, not to the one
  // that just replaced it. Unmounting flushes for the same reason. Nobody is
  // left to hear how the write went, so the promise is dropped on purpose.
  //
  // A conflicted note is held and not written, the way the hide below holds
  // it: flushing would put the reader's text over the other writer's with
  // nobody asked, and only `:w` gets to make that call. Its entry is marked
  // conflicted so the next opening shows the conflict and waits for the
  // reader. The held store is then the only copy of the text. `write` would
  // clear `pending` and the flag on its way out; nothing goes out here, so
  // they are cleared by hand, or the next note inherits them: `restore`
  // refuses while `pending` is set, and so does the opening's reset of the
  // status. A cleanup re-run on a new `path` is exactly the leave, and so is
  // one on a new `pane`: the pane left holds its own buffer of the note.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pane` is the trigger, and is not read.
  useEffect(
    () => () => {
      if (path === undefined || pending.current === null || !conflicted.current) {
        void save();
      } else {
        const entry = {
          content: pending.current,
          reason: "Changed on disk before the note was left",
          conflicted: true,
          base: lastBase(path),
        };
        holdText(path, entry, taken.current);
        heldAt.current.set(entry, { seq: saves.current, visit: visit.current });
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        pending.current = null;
        conflicted.current = false;
      }
      // The next visit offers held text afresh, and its buffer holds none yet.
      opening.current = true;
      take(null);
    },
    [path, pane, save, take, lastBase],
  );

  // A reload or a closed tab unmounts nothing, so the flush above never runs
  // for them, and the quiet period's text goes with the page. A phone sending
  // the app to the background fires no `pagehide` at all, only the
  // visibility change, and may never come back to fire anything else.
  //
  // The text is held before anything is sent: a keepalive write can still be
  // refused (over 64 KiB, no network, or the vault moved past its base) with
  // nobody left to hear it, and the held copy is what the next opening offers.
  // A landed write drops it, and one that landed after the page was gone is
  // recognised then by `landedAs`. A conflicted note is held and not written,
  // as on leaving: the reader decides on return.
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
      const air = inAir.current.get(path);
      const content = pending.current ?? air?.content;
      if (content === undefined) return;
      if (content === taken.current?.content) return;
      // Text typed behind a write in the air is typed on that write's text,
      // which the keepalive below names. Kept beside the base and not in its
      // place: the page may die before that write arrives. Not after a reload
      // since that write went out, which the text was typed on instead.
      const before = air?.loaded === reloads.current ? air.content : undefined;
      const entry = {
        content,
        reason: "Not yet written when the page was hidden",
        conflicted: conflicted.current,
        base: lastBase(path),
        after: before !== undefined && before !== content ? before : undefined,
      };
      holdText(path, entry, taken.current);
      // After every write already in the air, which a failing one reads.
      heldAt.current.set(entry, { seq: saves.current, visit: visit.current });
      take(entry);
      if (conflicted.current) return;
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
  // Runs on each opening, a new pane on the same note included: `queryClient`
  // and `restore` never change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pane` is the trigger, and is not read.
  useEffect(() => {
    visit.current += 1;
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
    // That editor shows the cached text, and asks nothing that would say so,
    // so it is the base now: read later, a route write's refetch may have
    // moved the cache under a buffer that declined it.
    onDisk.current = cached ?? null;
    // Against the cached text, as the editor's `held` reads it, so both mean
    // the entry typed into this note and pass over another note's.
    const held = path === undefined ? undefined : heldText(path, cached);
    const doc = shownRef.current?.();
    if (path !== undefined && cached !== undefined && held && doc !== undefined) {
      if (sameText(doc, held.content)) restore(path, cached);
    }
    // An editor still to mount opens on the entry held now, and only that one
    // is taken when it asks. See `opening`. An editor already showing other
    // text never takes it this visit: a later reload would put it in `pending`
    // under a screen that does not show it. Read again after the take above,
    // which drops an entry found landed and leaves the next one first.
    const next = path === undefined ? undefined : heldText(path, cached);
    const shownOther = doc !== undefined && next !== undefined && !sameText(doc, next.content);
    offered.current = shownOther ? undefined : next;
    opening.current = false;
    // The flush of the note left set `saving` on its way out and never answers
    // here, so the reading starts again for the note opened, unless it holds
    // text just taken.
    if (pending.current === null) {
      setStatus("saved");
      setReason(undefined);
    }
  }, [path, pane, queryClient, restore]);

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
    allowReload,
    reconcile,
  };
}
