import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChangedOnDisk, fetchNote, type Note, saveNote } from "@/lib/api";
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

/** A queued write a `:e!` threw away before its turn came, never sent (#301). */
class Skipped extends Error {}

/** A note's newest write still to answer; see `inAir` in the hook. */
interface InAir {
  content: string;
  loaded: number;
  base?: string;
  named?: string;
  stale: string[];
  visit: number;
  sent?: { content: string; loaded: number; visit: number };
  restoring: boolean;
  unseen?: InAir;
}

/**
 * The write ahead that the buffer never took, while no write of this buffer
 * went out since: the newest sent is still of that write's visit. By visit and
 * not by text, which the buffer may have typed again (#317).
 */
function unseenOf(air: InAir | undefined): InAir | undefined {
  const unseen = air?.unseen;
  return unseen !== undefined && air?.sent?.visit === unseen.visit ? unseen : undefined;
}

/**
 * The text the newest write to a note sent, which text typed behind it was
 * typed on. Not after a reload since, nor while that write is of a visit the
 * buffer never took: naming it would land over it unasked (#317).
 */
function sentUnder(air: InAir | undefined, loaded: number): string | undefined {
  if (air?.sent?.loaded !== loaded || unseenOf(air) !== undefined) return undefined;
  return air.sent.content;
}

/** How many times a clean buffer of `note` took the vault's text in. */
function reloadsOf(reloads: Map<string, number>, note: string): number {
  return reloads.get(note) ?? 0;
}

/** A note's last write still to answer; see `queued` below. */
interface Queued {
  link: Promise<string | undefined>;
  visit: number;
  loaded: number;
  ok: Promise<boolean>;
  // A later write names this one's link: typed on this text, it carries it.
  followed: boolean;
}

// The write queue, by note, and the counts its entries are stamped with: the
// page's, not the hook's. The route mounted again has a new hook, and the
// flush the old one sent on leaving is the head of the queue the reopened
// buffer joins (#386, #387). Its counts go on from the old hook's, or a new
// visit 1 would read as the old visit 1 that sent the flush.

// The same count as `reverts` by note, which a write still queued reads as it
// would go out (#301): a `:e!` on the note opened next throws away none of
// this one.
const dropped = { current: new Map<string, number>() };
// How many times a clean buffer took the vault's text in, which a failing
// write compares against the reading it left with: after one, the screen
// holds text not typed on the write's (#290). By note: a reload of the note
// opened next says nothing about the buffer a flush of this one left.
const reloads = { current: new Map<string, number>() };
// The notes a write is on its way to, counted rather than flagged: `:w`
// during a quiet write puts two in the air for one note, and the first to
// answer must not read as the last. By path, because the tail this answers is
// the note just left: its text is still in flight while the hook has already
// moved on, and nothing else on the route can see that write.
const writing = { current: new Map<string, number>() };
// The last text sent to each note while any write to it is in the air. A
// write empties `pending` as it goes out, and a plain fetch is cancelled with
// the page, so this is the only copy a hide can find of a quiet write's text.
// With the `reloads` count it left with: after a reload, text typed on is
// typed on the reload's text, and not on this. With the base it was typed on
// and the text it named once sent, so a hide after the note was left can
// hold and resend it for that note (#302). `stale` gathers the base and the
// named text of every write to the note still in the air, the earlier ones
// too: a read answering with one of them is from before a write (#304).
// `sent` is the text and `reloads` count of the newest write to the note
// that went out: a write still queued behind it was never sent, and a hide
// typed behind the queue finds that text on disk, not the queued one's
// (#310). `restoring` marks the write `:e!` queued with the vault's own
// text, which nobody typed and a hide neither holds nor sends (#311).
// `unseen` is the write ahead that a buffer reopened on the text under it
// never took: a write of that buffer replaces it here and inherits its
// `sent`, which is then text the buffer was not typed on (#317).
const inAir = { current: new Map<string, InAir>() };
// The last write to each note still to answer, resolving with the text on
// disk once it has, as far as the page knows. The next write to that note
// goes out behind it and names that text as its base: not the text the last
// one sent, which `stamp` may have given a block, and which a write that
// failed never put there. Only within the visit that made it: a flush from
// the visit before lands text the buffer reopened without, and naming it
// would let this buffer over it unasked. Nor after a reload into the clean
// buffer since it went out: the next write was typed on the reload's text,
// and still goes out behind it, but names that text (#298). A visit opened
// on the text the last write sent takes the link over (#303). `ok` answers
// whether every write in the queue so far landed, for `saveFirst` (#306).
const queued = { current: new Map<string, Queued>() };
// The notes whose outside write `reconcile` declined while a write to them
// was in the air, reloaded once the last of those writes answers (#296).
const missed = { current: new Set<string>() };
// Bumped by every write that goes out, which orders held entries against
// the writes that fail after them (`heldAt`).
const saves = { current: 0 };
// Bumped each time a note is opened, so a write knows whether the visit it
// was made in is still the one on screen.
const visit = { current: 0 };
// The `saves` count and the visit when each entry was held, so a failing
// write can tell an entry held after it went out on the same buffer (newer
// text, the hide's) from one typed on other text. In memory: the store keeps
// an unchanged entry's object.
const heldAt = { current: new WeakMap<Held, { seq: number; visit: number }>() };
/**
 * The entries held as the editor route unmounted, of writes then in the air.
 * The cache the leave filled reads to the hook mounted next as the vault's
 * text (#382). Each leaves the store when its write answers.
 */
let leftAloft = new WeakSet<Held>();

/** Forget every write of the page, as a new page starts with none. For tests. */
export function forgetQueues(): void {
  queued.current = new Map();
  inAir.current = new Map();
  writing.current = new Map();
  dropped.current = new Map();
  reloads.current = new Map();
  missed.current = new Set();
  saves.current = 0;
  visit.current = 0;
  heldAt.current = new WeakMap();
  leftAloft = new WeakSet();
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
  // The note followed now, for a flush answering with the closure of the
  // visit it left: that note may be open again by then.
  const openRef = useRef(path);
  openRef.current = path;
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
  // The held entry the buffer holds, by identity, and the same as state for
  // the bar, which leaves out that entry alone while it is on screen.
  // Identity rather than path: a flush that fails after its note was reopened
  // holds a second entry the buffer never saw, and a save of the buffer must
  // not take that one with it.
  const taken = useRef<Held | null>(null);
  const [restored, setRestored] = useState<Held | null>(null);
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
   * Take the entry a write of `note` held as it failed into a clean buffer
   * reopened on its text, which nothing else is writing: the screen keeps it,
   * taken as a failed write is. Answers whether it did.
   */
  const takeFailed = useCallback(
    (note: string, held: Held): boolean => {
      const doc = shownRef.current?.();
      if (
        openRef.current !== note ||
        pending.current !== null ||
        writing.current.has(note) ||
        doc === undefined ||
        !sameText(doc, held.content)
      ) {
        return false;
      }
      take(held);
      pending.current = held.content;
      conflicted.current ||= held.conflicted;
      setStatus(conflicted.current ? "conflict" : "error");
      setReason(held.reason);
      return true;
    },
    [take],
  );

  /**
   * Follow the write to `note` in the air whose text the buffer reopened on,
   * sent by the hook that went with the route and hears its answer alone
   * (#387). Landed, its answer is the base; failed, the clean buffer takes
   * the entry it held, as on a reopen within the route.
   */
  const follow = useCallback(
    (note: string, held: Held) => {
      const queue = queued.current.get(note);
      if (queue === undefined) return;
      queue.visit = visit.current;
      const at = visit.current;
      const loaded = reloadsOf(reloads.current, note);
      // A `:e!` since put the vault's text under the buffer, and queued the
      // write that answers for it.
      const sent = reverts.current;
      void Promise.all([queue.link, queue.ok]).then(([text, ok]) => {
        if (
          visit.current !== at ||
          reloadsOf(reloads.current, note) !== loaded ||
          reverts.current !== sent
        ) {
          return;
        }
        if (text !== undefined) onDisk.current = text;
        if (ok) {
          if (taken.current === held) take(null);
          return;
        }
        const failed = heldTexts(note).find((entry) => entry.content === held.content);
        if (failed !== undefined) takeFailed(note, failed);
      });
    },
    [take, takeFailed],
  );

  /**
   * Resolves to whether the vault holds the text, so `<leader>q` can refuse.
   *
   * `keepalive` for the write as the page goes away, which the browser would
   * otherwise cancel along with it. `restoring` for the write `:e!` queues
   * behind one in the air, which puts the vault's text back (#311).
   */
  const write = useCallback(
    (keepalive: boolean, leaving = false, restoring = false): Promise<boolean> => {
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
      const loaded = reloadsOf(reloads.current, path);
      setStatus("saving");
      setReason(undefined);
      const to = path;
      const kept = dropped.current.get(to) ?? 0;
      // Whether this note's buffer took the vault's text in since this went out.
      const reloaded = () => reloadsOf(reloads.current, to) !== loaded;
      const opened = visit.current;
      // Read before the line below replaces it: the keepalive names the last
      // write that went out, which lands first and is what it finds on disk.
      // Not a write queued behind that one, which never left, and dies with
      // the page (#310). Only when this buffer follows the queue, as a quiet
      // write's `follows` reads it: a buffer reopened on the text under that
      // write, or reloaded since, was typed on that text, and naming the
      // write's would land over it unasked.
      const air = inAir.current.get(to);
      const ahead = queued.current.get(to);
      const follows = ahead?.visit === opened && ahead.loaded === loaded;
      const before = follows ? sentUnder(air, loaded) : undefined;
      writing.current.set(to, (writing.current.get(to) ?? 0) + 1);
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
      const stale = [...(air?.stale ?? [])];
      if (base !== undefined) stale.push(base);
      const flying: InAir = {
        content,
        loaded,
        base,
        named: undefined,
        stale,
        visit: opened,
        sent: air?.sent,
        restoring,
        unseen: follows ? air?.unseen : air?.loaded === loaded && !air.restoring ? air : undefined,
      };
      inAir.current.set(to, flying);
      // The text leaving a note goes into the cache as it leaves, so a reopen
      // or a second pane opens on it and not on what came before it (#303).
      // A failure puts the base it named back (`settle`).
      const prior = queryClient.getQueryData<string>(["note", to]);
      if (leaving) queryClient.setQueryData(["note", to], content);
      // Held text is kept by path, and the note may move before this answers.
      const since = movesMade();
      // A failure with no HTTP status may have come after the server wrote
      // (#307), so the vault is read again before anything names a base. Once,
      // shared by the link and the failure arm; the base named if that fails too.
      // Taken only when it holds this text: other text is somebody else's write,
      // and the next write naming it would land over it unasked.
      let fresh: Promise<string | undefined> | undefined;
      const reread = () => {
        fresh ??= Promise.resolve(to)
          .then(fetchNote)
          .then(
            (text) => text,
            (_failure: unknown) => undefined,
          )
          .then((text) => (text !== undefined && landedAs(content, text) ? text : named));
        return fresh;
      };

      // No base for the overwrite `:w` makes of a conflict. Two arguments
      // unless it names one, which is the call every other writer makes.
      const send = (under: string | undefined): Promise<Note> => {
        // Thrown away by `:e!` while it waited its turn (#301).
        if ((dropped.current.get(to) ?? 0) !== kept) return Promise.reject(new Skipped());
        named = under;
        flying.named = under;
        // Onto whichever entry is newest now: a later write took this one's place.
        const newest = inAir.current.get(to);
        if (under !== undefined) newest?.stale.push(under);
        if (newest !== undefined) newest.sent = { content, loaded, visit: opened };
        return under === undefined || wasConflicted
          ? saveNote(to, content)
          : saveNote(to, content, false, noteBase(under));
      };
      let request: Promise<Note>;
      let link: Promise<string | undefined>;
      if (keepalive) {
        // Named too, so a page going away cannot write over somebody else.
        // Text typed behind a write in the air names that write, which left
        // first and lands first. The same text as that write names its base:
        // it lands if the page cancelled that write, and is the server's no-op
        // if it landed.
        const under = before !== undefined && before !== content ? before : base;
        named = under;
        flying.named = under;
        flying.sent = { content, loaded, visit: opened };
        if (under !== undefined) stale.push(under);
        // Whether the write ahead answered, read when the refusal comes.
        let answeredAhead = false;
        void ahead?.link.then(() => {
          answeredAhead = true;
        });
        const first =
          under === undefined
            ? saveNote(to, content, true)
            : saveNote(to, content, true, noteBase(under));
        // Refused while the write ahead failed: `under` was a guess at what
        // that write lands, and it never did. The page lived on, so this goes
        // again naming what the vault holds after it (#305). Refused before
        // that write answered, this overtook it on the way and found the text
        // under it (#310): it goes again too, whatever that write landed.
        // Only a refusal after a write ahead that landed `under` is somebody
        // else's write since. The resend names what the vault answered, so
        // the 409 still guards it. Never for a keepalive that named the base:
        // the buffer was not typed on that write's text, and the refusal is
        // the conflict between the two.
        request = first.then(
          (note) => note,
          async (failure: unknown) => {
            if (
              !(failure instanceof ChangedOnDisk) ||
              ahead === undefined ||
              under === undefined ||
              under !== before
            ) {
              throw failure;
            }
            const overtook = !answeredAhead;
            const landed = await ahead.link;
            if (landed === undefined || (!overtook && landedAs(under, landed))) throw failure;
            return send(landed);
          },
        );
        // In the queue as well, though it cannot wait its turn: the next write
        // names its answer, and goes out after the write ahead of it too.
        link = Promise.all([
          ahead?.link,
          request.then(
            (note) => note.content,
            (_failure: unknown) => (ahead === undefined ? base : ahead.link),
          ),
        ]).then(([, text]) => text);
      } else {
        if (follows) ahead.followed = true;
        const under = follows ? ahead.link : Promise.resolve(base);
        request = ahead === undefined ? send(base) : ahead.link.then(() => under).then(send);
        // Never rejects, so a failed write still lets the next one go: the vault
        // did not move, as far as this hook knows.
        link = request.then(
          (note) => note.content,
          (failure: unknown) => (failure instanceof TypeError ? reread() : under),
        );
      }
      // The last write's outcome is the queue's: a later write carries the text
      // of the ones before it, so its landing settles their failures. A write
      // `:e!` threw away before it went out leaves the outcome to those.
      const ok = Promise.all([
        ahead?.ok ?? true,
        request.then(
          () => true,
          (failure: unknown) => (failure instanceof Skipped ? undefined : false),
        ),
      ]).then(([before, mine]) => mine ?? before);
      const mine = { link, visit: opened, loaded, ok, followed: false };
      queued.current.set(to, mine);
      void link.then(() => {
        if (queued.current.get(to)?.link === link) queued.current.delete(to);
      });
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
          if (here() && !reloaded()) onDisk.current = note.content;
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
          // Never sent: the buffer holds the vault's text, and this was thrown away.
          if (failure instanceof Skipped) return false;
          // The vault's own text, which nobody typed: nothing to hold or to
          // retry. Refused, somebody wrote since, and their event reloads the
          // clean buffer once nothing is in the air (#311).
          if (restoring) {
            if (here() && pending.current === null && !writing.current.has(to)) {
              setStatus("saved");
            }
            return false;
          }
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
          if (newer && !reloaded()) return false;
          // A failure other than a refusal leaves the vault on the text this
          // named, which an older write behind it may have landed while the
          // cache was kept off it (#296). The cache gets that text once no
          // write to the note is left, or a reopen would read the vault as
          // moved past the held text's base, and a second pane would show the
          // older one. Not after a `:e!` or a reload, which put the vault's
          // text there since, nor for a conflicted note, whose base is stale.
          // Nor for a keepalive, whose base is a guess at what the write ahead
          // of it lands and not an answer, nor once the note moved: the count
          // and the cache key are the old path's.
          const put = (text: string | undefined) => {
            if (
              text !== undefined &&
              !keepalive &&
              movedTo(to, since) === to &&
              !refused &&
              !wasConflicted &&
              reverts.current === sent &&
              !reloaded() &&
              !writing.current.has(to)
            ) {
              queryClient.setQueryData(["note", to], text);
            }
          };
          // With no HTTP status the vault may hold this text after all, so
          // its read stands in for the base named, here and in `onDisk` (#307).
          const settle = () => {
            // The leave's own text is not the vault's after all: what was there
            // goes back, unless a later write or the checks below put more.
            if (
              leaving &&
              !writing.current.has(to) &&
              queryClient.getQueryData(["note", to]) === content
            ) {
              if (prior === undefined)
                queryClient.removeQueries({ queryKey: ["note", to], exact: true });
              else queryClient.setQueryData(["note", to], prior);
            }
            if (!(failure instanceof TypeError) || keepalive) {
              put(named);
              return;
            }
            void reread().then((text) => {
              if (
                here() &&
                text !== undefined &&
                (dropped.current.get(to) ?? 0) === kept &&
                !reloaded()
              ) {
                onDisk.current = text;
              }
              put(text);
            });
          };
          // Its own send count: a write sent after this one and failing first
          // holds newer text, which this must not replace either.
          heldAt.current.set(held, { seq, visit: opened });
          // A later write, of another visit too, was typed on this text and
          // carries it: held, this older text would be offered as a conflict
          // with it, and `:w` there would lose the newer. That write's own
          // failure holds its text, as the #290 rule does on one visit.
          if (mine.followed) return false;
          // The flush of a note already left: `pending` now holds the next note's
          // text, and a retry would write this one's into it. So the text is held
          // for its own note, which takes it back when it is opened again, and
          // the bar lists it meanwhile. Nothing here touches the next note's
          // reading. Ahead of the revert check, because a `:e!` since then was on
          // the next note and threw away that one's text, not this.
          if (!here()) {
            holdText(now, held, carried);
            // Reopened on this very text, the cache keeps it too. Put back,
            // the clean screen would take the old text and leave this on the
            // bar alone (#303).
            if (takeFailed(now, held)) return false;
            settle();
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
          if (saves.current !== seq && !reloaded()) return false;

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
            reloaded() ||
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
          // After `pending`, so the editor asking about the cache finds the
          // buffer dirty and keeps this text on screen.
          settle();
          setReason(message);
          return false;
        },
      );
    },
    [path, queryClient, take, lastBase, takeFailed],
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
  const saveFirst = useCallback((): Promise<boolean> => {
    if (conflicted.current) return Promise.resolve(false);
    const mine = save();
    // Rename and delete must not race a write in the air (#306): the key
    // waits for the note's queue, the write just made included, and refuses
    // when any write in it did not land.
    const queue = path === undefined ? undefined : queued.current.get(path);
    return Promise.all([mine, queue?.ok ?? true]).then(([landed, all]) => landed && all);
  }, [save, path]);

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
      if (path !== undefined) dropped.current.set(path, (dropped.current.get(path) ?? 0) + 1);
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
      if (path !== undefined && taken.current) dropText(path, taken.current);
      take(null);
      // Before the write below, which says "saving" and must have the last word.
      setStatus("saved");
      setReason(undefined);
      if (path === undefined) return true;
      // A write already sent lands its text anyway, and the vault would hold
      // what the reader threw away, its event putting it back on the clean
      // screen (#311). So the vault's text goes out behind it, an ordinary
      // write in the queue that names its answer: refused, somebody wrote
      // since, and their text stands. It takes the entry's place in `inAir`,
      // so a hide resends the vault's text and not the thrown-away one. That
      // text and the one sent stay in `stale`, so a slow read of either is
      // declined while the restore is in the air.
      const thrown = inAir.current.get(path);
      if (busy && onDisk.current !== null) {
        pending.current = onDisk.current;
        void write(false, false, true);
        const restore = inAir.current.get(path);
        if (thrown !== undefined) restore?.stale.push(thrown.content);
        if (thrown?.sent !== undefined) restore?.stale.push(thrown.sent.content);
      } else {
        inAir.current.delete(path);
      }
      return true;
    },
    [path, take, queryClient, write],
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

  /**
   * Hold the text of `note`'s buffer that the page going away would lose: a
   * quiet write in the air, and what is waiting. Answers the entry held for
   * what is waiting, or of the write in the air when nothing is, which a hide
   * then sends; undefined when that text is held already or there is none.
   *
   * Nothing waiting, but a quiet write may still be in the air, and the page
   * going away cancels it. Not after a reload since it went out: that text is
   * on screen nowhere (#306). Nor the write `:e!` queued with the vault's
   * text, which nobody typed: held, it would read as the reader's and stand as
   * a conflict with whoever wrote since (#311).
   */
  const holdOwn = useCallback(
    (note: string, reason: string): Held | undefined => {
      const loaded = reloadsOf(reloads.current, note);
      const queue = queued.current.get(note);
      const follows = queue?.visit === visit.current && queue.loaded === loaded;
      const air = inAir.current.get(note);
      const fresh = air?.loaded === loaded && !air.restoring ? air : undefined;
      // A buffer reopened on the text under that write, which it does not
      // follow, shows other text: a keepalive would land this unseen (#314). Held
      // only, under the base it was typed on, so the page dying still keeps
      // it, and the quiet write landing drops it. Beside it the text the write
      // named, as the hide's loop keeps it: a write ahead of it that landed is
      // the reader's own, no conflict on reopening. Held as well when text was
      // typed on the screen's text since: that goes out on its own, and the
      // page dying would cancel the write and keep its text nowhere (#317).
      // So too when that text already went to the queue and the buffer follows
      // its own write, still waiting behind the one it never took.
      const offScreen = follows ? unseenOf(fresh) : fresh;
      if (offScreen !== undefined) {
        const out = offScreen.sent?.loaded === offScreen.loaded ? offScreen.sent : undefined;
        const under =
          out === undefined
            ? offScreen.base
            : out.content === offScreen.content
              ? (offScreen.named ?? offScreen.base)
              : out.content;
        const entry: Held = {
          content: offScreen.content,
          reason,
          conflicted: conflicted.current,
          base: offScreen.base,
          after: under !== offScreen.base ? under : undefined,
        };
        holdText(note, entry);
        heldAt.current.set(entry, { seq: saves.current, visit: offScreen.visit });
        if (!follows && pending.current === null) return undefined;
      }
      const content = pending.current ?? fresh?.content;
      if (content === undefined) return undefined;
      if (content === taken.current?.content) return undefined;
      // Text typed behind a write in the air is typed on that write's text,
      // which the keepalive names: the last one sent, a queued one never
      // reaching the vault (#310). Kept beside the base and not in its place:
      // the page may die before that write arrives. Not after a reload since
      // that write went out, which the text was typed on instead, nor when the
      // buffer does not follow the queue, `write`'s own test.
      const before = follows ? sentUnder(air, loaded) : undefined;
      const entry = {
        content,
        reason,
        conflicted: conflicted.current,
        base: lastBase(note),
        after: before !== undefined && before !== content ? before : undefined,
      };
      holdText(note, entry, taken.current);
      // After every write already in the air, which a failing one reads.
      heldAt.current.set(entry, { seq: saves.current, visit: visit.current });
      return entry;
    },
    [lastBase],
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
      if (!held || pending.current !== null) return undefined;
      if (!opening.current && held !== offered.current) return undefined;
      // The text of a write another hook still has in the air, which the leave
      // put in the cache: not landed yet, and the page closing would cancel
      // it. Taken, so the bar leaves it out and a hide holds it as it is; that
      // write landing drops it, or failing holds it again. The vault under
      // the buffer is the text under that write until it answers (#386). An
      // opening's effect follows it once it bumped the visit, which a take
      // before it would compare against the old one (`follow`).
      if (leftAloft.has(held) && landedAs(held.content, text)) {
        if (taken.current === held) return true;
        const air = inAir.current.get(note);
        onDisk.current = air === undefined ? text : (air.base ?? null);
        take(held);
        if (!opening.current) follow(note, held);
        return true;
      }
      if (writing.current.has(note)) return undefined;
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
    [take, follow],
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

      // While a write to the note is in the air, a read answering with the
      // text under it is from before the write, a step behind the screen
      // (#304): declined, and the note reloads once the write answers. A
      // buffer that takes the sent text was typed on it, so its next write
      // names the write's answer (#303). Other text is somebody else's, and
      // goes in as a reload (#297, #298). Not after `:e!`, which took the note
      // out of the air.
      const air = path === undefined ? undefined : inAir.current.get(path);
      if (pending.current === null && path !== undefined && air !== undefined) {
        if (landedAs(air.content, text)) {
          const queue = queued.current.get(path);
          if (queue !== undefined) queue.visit = visit.current;
          return true;
        }
        if (air.stale.some((each) => landedAs(each, text))) {
          missed.current.add(path);
          return false;
        }
      }
      // Taken into the buffer, so the vault under it is this text now, and the
      // next write names it as its base.
      if (pending.current === null) {
        onDisk.current = text;
        // Only text the screen lacks: the editor asks with the text it already
        // shows as well, and that replaces nothing.
        const doc = shownRef.current?.();
        if (path !== undefined && doc !== undefined && !sameText(doc, text)) {
          reloads.current.set(path, reloadsOf(reloads.current, path) + 1);
        }
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
   *
   * Yes for a conflicted buffer as well (#269): the other writer may have
   * written the buffer's own text, which settles the conflict, and only the
   * read can say so. `allowReload` takes that text and nothing else, so the
   * buffer keeps its words over any other.
   */
  const reconcile = useCallback((): boolean => {
    if (path !== undefined && writing.current.has(path)) {
      missed.current.add(path);
      return false;
    }
    return pending.current === null || conflicted.current;
  }, [path]);

  // Leaving the route takes the `pagehide` listener below with it, so a page
  // closed before the flush answers cancels it unheard, and the quiet write
  // in the air too (#382). Their text is held first, as a hide holds it, and
  // each one landing drops its copy. Only on unmount: a note left within the
  // route is still the hide's to hold, and holding it here would list it on
  // the bar until its flush lands. Ahead of the flush, which empties `pending`,
  // because React runs an unmount's cleanups in order.
  useEffect(
    () => () => {
      if (openRef.current === undefined) return;
      const entry = holdOwn(openRef.current, "Not yet written when the note was left");
      if (entry !== undefined) leftAloft.add(entry);
    },
    [holdOwn],
  );

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
        void write(false, true);
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
    [path, pane, write, take, lastBase],
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
    const hide = () => {
      // The flush to a note already left is in the air too, and dies with the
      // page as well (#302). Held for its own note under the base it was typed
      // on, and sent again with keepalive naming what it named; landing, the
      // copy goes. Not after a reload of that note since it went out: the
      // screen holds text this was not typed on (#306). A write still queued
      // was never sent, and names the last one that was, which is what lands
      // under it (#310). Not the vault's own text `:e!` put back (#311).
      for (const [note, air] of [...inAir.current]) {
        if (note === path || air.restoring || air.loaded !== reloadsOf(reloads.current, note)) {
          continue;
        }
        const out = air.sent?.loaded === air.loaded ? air.sent : undefined;
        const under =
          out === undefined
            ? air.base
            : out.content === air.content
              ? (air.named ?? air.base)
              : out.content;
        const entry: Held = {
          content: air.content,
          reason: "Not yet written when the page was hidden",
          conflicted: false,
          base: air.base,
          after: under !== air.base ? under : undefined,
        };
        holdText(note, entry);
        // On the visit the text was typed in, as that visit's hide would have
        // held it: an older write of that visit failing behind it then reads
        // this as newer text typed on its own, and drops itself (#290).
        heldAt.current.set(entry, { seq: saves.current, visit: air.visit });
        void (
          under === undefined
            ? saveNote(note, air.content, true)
            : saveNote(note, air.content, true, noteBase(under))
        ).then(
          (written) => {
            if (landedAs(air.content, written.content)) dropText(note, entry);
          },
          // Refused or cut off: the held copy is what the next opening offers.
          (_failure: unknown) => undefined,
        );
      }
      if (path === undefined) return;
      // The text held is sent again with keepalive, and the quiet write
      // landing after all drops the held copy.
      const entry = holdOwn(path, "Not yet written when the page was hidden");
      if (entry === undefined) return;
      take(entry);
      if (conflicted.current) return;
      // In `pending` only to be sent: a held in-flight text put there would
      // outlive its own write landing, and leave the note reading unsaved.
      pending.current = entry.content;
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
  }, [path, write, take, holdOwn]);

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
    // Not the text a write still in the air sent, which the leave put there:
    // a buffer that never took it was typed on the text under it, and names
    // that. One that takes it follows the write's answer (`allowReload`, #303).
    const air = path === undefined ? undefined : inAir.current.get(path);
    onDisk.current =
      air !== undefined && cached !== undefined && sameText(cached, air.content)
        ? (air.base ?? null)
        : (cached ?? null);
    // Against the cached text, as the editor's `held` reads it, so both mean
    // the entry typed into this note and pass over another note's.
    const held = path === undefined ? undefined : heldText(path, cached);
    const doc = shownRef.current?.();
    // A standby pane took the sent text through the route's own reload and
    // asks this hook nothing on the way in, so the follow `allowReload` makes
    // is made here for it: its writes name the write's answer (#303).
    if (
      path !== undefined &&
      air !== undefined &&
      doc !== undefined &&
      sameText(doc, air.content)
    ) {
      const queue = queued.current.get(path);
      if (queue !== undefined) queue.visit = visit.current;
    }
    if (path !== undefined && cached !== undefined && held && doc !== undefined) {
      if (sameText(doc, held.content)) restore(path, cached);
    }
    // The leave's write the buffer took, which its sender no longer hears.
    if (path !== undefined && taken.current !== null && leftAloft.has(taken.current)) {
      follow(path, taken.current);
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
  }, [path, pane, queryClient, restore, follow]);

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
