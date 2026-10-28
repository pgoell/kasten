import type { QueryClient } from "@tanstack/react-query";
import { ChangedOnDisk, fetchNote, type Note, saveNote } from "@/lib/api";
import { dropText, type Held, holdText, landedAs, movesMade } from "@/lib/held-text";
import { heldOf, type InAir, sentUnder } from "@/lib/note/in-air";
import { noteBase } from "@/lib/note-base";

/** One fewer write in the air for `note`, taking the entry when it reaches none. */
function lower(counts: Map<string, number>, note: string): void {
  const left = (counts.get(note) ?? 0) - 1;
  if (left > 0) counts.set(note, left);
  else counts.delete(note);
}

/** A queued write a `:e!` threw away before its turn came, never sent (#301). */
export class Skipped extends Error {}

/** A note's last write still to answer; see `#queued` below. */
interface Queued {
  link: Promise<string | undefined>;
  visit: number;
  loaded: number;
  ok: Promise<boolean>;
  // A later write names this one's link: typed on this text, it carries it.
  followed: boolean;
}

/** What a write of the buffer asks of the queue: the text and the buffer's state as it went. */
export interface Asked {
  to: string;
  content: string;
  keepalive: boolean;
  leaving: boolean;
  restoring: boolean;
  wasConflicted: boolean;
  // What the vault held under the buffer as far as the visit knew.
  base: string | undefined;
  // The buffer's `:e!` count, which the answer compares against.
  sent: number;
  // The held entry the write carries.
  carried: Held | null;
}

/** A write as it went out: what was asked, stamped with the queue's counts. */
export interface Write extends Asked {
  // The page's send count, this write's own.
  seq: number;
  // The visit it was made in.
  opened: number;
  // The note's reload count.
  loaded: number;
  // The note's `:e!` count, which a write queued behind others reads as it goes.
  kept: number;
}

/** What `enqueue` leaves for the write's answer: the write, the request and the queue's record of it. */
export interface Queueing {
  write: Write;
  request: Promise<Note>;
  mine: Queued;
  prior: string | undefined;
  since: number;
  named: () => string | undefined;
  reread: () => Promise<string | undefined>;
}

// The write queue, by note, and the counts its entries are stamped with: the
// page's, not the hook's. The route mounted again has a new hook, and the
// flush the old one sent on leaving is the head of the queue the reopened
// buffer joins (#386, #387). Its counts go on from the old hook's, or a new
// visit 1 would read as the old visit 1 that sent the flush.
// Its maps are its own: the methods below are the only way to them (#708).
export class SaveQueue {
  // The same count as `reverts` by note, which a write still queued reads as it
  // would go out (#301): a `:e!` on the note opened next throws away none of
  // this one.
  #dropped = new Map<string, number>();
  // How many times a clean buffer took the vault's text in, which a failing
  // write compares against the reading it left with: after one, the screen
  // holds text not typed on the write's (#290). By note: a reload of the note
  // opened next says nothing about the buffer a flush of this one left.
  #reloads = new Map<string, number>();
  // The notes a write is on its way to, counted rather than flagged: `:w`
  // during a quiet write puts two in the air for one note, and the first to
  // answer must not read as the last. By path, because the tail this answers is
  // the note just left: its text is still in flight while the hook has already
  // moved on, and nothing else on the route can see that write.
  #writing = new Map<string, number>();
  // The newest write to each note still to answer (`InAir`).
  #inAir = new Map<string, InAir>();
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
  #queued = new Map<string, Queued>();
  // The notes whose outside write `reconcile` declined while a write to them
  // was in the air, reloaded once the last of those writes answers (#296).
  #missed = new Set<string>();
  // Bumped by every write that goes out, which orders held entries against
  // the writes that fail after them (`#heldAt`).
  #saves = 0;
  // Bumped each time a note is opened, so a write knows whether the visit it
  // was made in is still the one on screen.
  #visit = 0;
  // The `saves` count and the visit when each entry was held, so a failing
  // write can tell an entry held after it went out on the same buffer (newer
  // text, the hide's) from one typed on other text. In memory: the store keeps
  // an unchanged entry's object.
  #heldAt = new WeakMap<Held, { seq: number; visit: number }>();

  /** Whether a write to `note` is in the air. */
  busy(note: string): boolean {
    return this.#writing.has(note);
  }

  /** How many writes went out. */
  get sends(): number {
    return this.#saves;
  }

  /** The visit on screen. */
  get visit(): number {
    return this.#visit;
  }

  /** A note opened: the visit moves on, and answers the new one. */
  open(): number {
    this.#visit += 1;
    return this.#visit;
  }

  /** How many times a clean buffer of `note` took the vault's text in. */
  reloadsOf(note: string): number {
    return this.#reloads.get(note) ?? 0;
  }

  /** A clean buffer of `note` took the vault's text in. */
  reload(note: string): void {
    this.#reloads.set(note, this.reloadsOf(note) + 1);
  }

  /** `:e!` on `note`: a write of it still queued is thrown away as it would go out. */
  drop(note: string): void {
    this.#dropped.set(note, (this.#dropped.get(note) ?? 0) + 1);
  }

  /** Whether no `:e!` on its note came since `write` went into the queue. */
  kept(write: Write): boolean {
    return (this.#dropped.get(write.to) ?? 0) === write.kept;
  }

  /** Whether no write went out after `write`. */
  isNewest(write: Write): boolean {
    return this.#saves === write.seq;
  }

  /** An outside write to `note` was declined while ours were in the air: read it once they answer. */
  miss(note: string): void {
    this.#missed.add(note);
  }

  /** The note's newest write still to answer, the live entry. */
  air(note: string): InAir | undefined {
    return this.#inAir.get(note);
  }

  /** Whether the buffer on screen follows the note's queue: of this visit, and no reload since. */
  follows(note: string): boolean {
    const ahead = this.#queued.get(note);
    return ahead?.visit === this.#visit && ahead.loaded === this.reloadsOf(note);
  }

  /**
   * The buffer on screen took the text of the note's last write: the queue
   * moves onto this visit, and answers that write's link and outcome.
   */
  follow(note: string): { link: Promise<string | undefined>; ok: Promise<boolean> } | undefined {
    const queue = this.#queued.get(note);
    if (queue !== undefined) queue.visit = this.#visit;
    return queue;
  }

  /** Whether every write in the note's queue so far landed, once they answered. */
  settled(note: string): Promise<boolean> | boolean {
    return this.#queued.get(note)?.ok ?? true;
  }

  /**
   * The read rule's stale check on a read of `note` while a write to it is in
   * the air: true for that write's text, which the buffer now follows; false
   * for text from before it, read again once the writes answer.
   */
  staleRead(note: string, text: string): boolean | undefined {
    const air = this.#inAir.get(note);
    if (air === undefined) return undefined;
    if (landedAs(air.content, text)) {
      this.follow(note);
      return true;
    }
    if (air.stale.some((each) => landedAs(each, text))) {
      this.#missed.add(note);
      return false;
    }
    return undefined;
  }

  /**
   * `:e!` on `note`: the note leaves the air, or `restore` queues the write of
   * the vault's text and the thrown text goes into its stale list.
   */
  revert(note: string, restore?: () => void): void {
    const thrown = this.#inAir.get(note);
    if (restore === undefined) {
      this.#inAir.delete(note);
      return;
    }
    restore();
    const restoring = this.#inAir.get(note);
    if (thrown !== undefined) restoring?.stale.push(thrown.content);
    if (thrown?.sent !== undefined) restoring?.stale.push(thrown.sent.content);
  }

  /** Mark `entry` held now, or at `at`. */
  markHeld(
    entry: Held,
    at: { seq: number; visit: number } = { seq: this.#saves, visit: this.#visit },
  ): void {
    this.#heldAt.set(entry, at);
  }

  /** Whether `entry` was held after `write` went out, on the same visit. */
  newerHeld(entry: Held, write: Write): boolean {
    const at = this.#heldAt.get(entry);
    return at?.visit === write.opened && at.seq >= write.seq;
  }

  /** A write of `to` answered: its count goes down, and the note's entry leaves the air when none is left. */
  answered(to: string, queryClient: QueryClient): void {
    lower(this.#writing, to);
    if (this.#writing.has(to)) return;
    this.#inAir.delete(to);
    // An outside write declined while this was in the air is read now,
    // once nothing of ours can land over it. The refetch answers later, so
    // the arm below settles this write before the editor asks.
    if (this.#missed.delete(to)) {
      void queryClient.invalidateQueries({ queryKey: ["note", to] }, { cancelRefetch: false });
    }
  }

  /** Forget the writes of the page, as a new page starts with none. */
  forget(): void {
    this.#queued = new Map();
    this.#inAir = new Map();
    this.#writing = new Map();
    this.#dropped = new Map();
    this.#reloads = new Map();
    this.#missed = new Set();
    this.#saves = 0;
    this.#visit = 0;
    this.#heldAt = new WeakMap();
  }

  /** Put a write of the buffer in the note's queue, stamped with the page's counts. */
  enqueue(asked: Asked, queryClient: QueryClient): Queueing {
    const { to, content, keepalive, leaving, restoring, wasConflicted, base } = asked;
    this.#saves += 1;
    const loaded = this.reloadsOf(to);
    const kept = this.#dropped.get(to) ?? 0;
    const opened = this.#visit;
    const write: Write = { ...asked, seq: this.#saves, opened, loaded, kept };
    // Read before the line below replaces it: the keepalive names the last
    // write that went out, which lands first and is what it finds on disk.
    // Not a write queued behind that one, which never left, and dies with
    // the page (#310). Only when this buffer follows the queue, as a quiet
    // write's `follows` reads it: a buffer reopened on the text under that
    // write, or reloaded since, was typed on that text, and naming the
    // write's would land over it unasked.
    const air = this.#inAir.get(to);
    const ahead = this.#queued.get(to);
    const follows = ahead?.visit === opened && ahead.loaded === loaded;
    const before = follows ? sentUnder(air, loaded) : undefined;
    this.#writing.set(to, (this.#writing.get(to) ?? 0) + 1);
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
    this.#inAir.set(to, flying);
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
      if ((this.#dropped.get(to) ?? 0) !== kept) return Promise.reject(new Skipped());
      named = under;
      flying.named = under;
      // Onto whichever entry is newest now: a later write took this one's place.
      const newest = this.#inAir.get(to);
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
      if (follows && ahead) ahead.followed = true;
      const under = follows && ahead ? ahead.link : Promise.resolve(base);
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
    this.#queued.set(to, mine);
    void link.then(() => {
      if (this.#queued.get(to)?.link === link) this.#queued.delete(to);
    });
    return { write, request, mine, prior, since, named: () => named, reread };
  }

  /**
   * The flush of a note already left, and of the write still in the air for
   * each, when the page is hidden: each is held and sent again with keepalive.
   */
  resendLeft(path: string | undefined): void {
    // The flush to a note already left is in the air too, and dies with the
    // page as well (#302). Held for its own note under the base it was typed
    // on, and sent again with keepalive naming what it named; landing, the
    // copy goes. Not after a reload of that note since it went out: the
    // screen holds text this was not typed on (#306). A write still queued
    // was never sent, and names the last one that was, which is what lands
    // under it (#310). Not the vault's own text `:e!` put back (#311).
    for (const [note, air] of [...this.#inAir]) {
      if (note === path || air.restoring || air.loaded !== this.reloadsOf(note)) {
        continue;
      }
      const { entry, under } = heldOf(air, "Not yet written when the page was hidden", false);
      holdText(note, entry);
      // On the visit the text was typed in, as that visit's hide would have
      // held it: an older write of that visit failing behind it then reads
      // this as newer text typed on its own, and drops itself (#290).
      this.#heldAt.set(entry, { seq: this.#saves, visit: air.visit });
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
  }
}

/** The page's write queue. */
export const saveQueue = new SaveQueue();
