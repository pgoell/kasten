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
  base: string | undefined;
  // The buffer's `:e!` count, which the answer compares against.
  sent: number;
  carried: Held | null;
}

/** A write as it went out: what was asked, stamped with the queue's counts. */
export interface Write extends Asked {
  seq: number;
  opened: number;
  loaded: number;
  // `:e!` count when it went in, not when it goes out.
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

// Shared by every hook on the page: a reopened buffer joins the flush the old hook sent (#386, #387).
// Counts carry on from the old hook's, so a new visit 1 is not the old visit 1 (#387).
// Its maps are private, and the methods below are the only way to them (#708).
export class SaveQueue {
  // `:e!` count per note: a write queued before it is thrown away as it goes out (#301).
  #dropped = new Map<string, number>();
  // Clean-buffer reloads per note, so a failing write knows the screen holds text it was not typed on (#290).
  #reloads = new Map<string, number>();
  // Writes in the air per note, counted: `:w` during a quiet write puts two in the air, and the first
  // answer must not read as the last. By path: the note just left can still be in flight after the hook moved on.
  #writing = new Map<string, number>();
  #inAir = new Map<string, InAir>();
  // Last write per note still to answer, with the text on disk once it has, as far as the page knows.
  // The next write names that text as its base, not what the last one sent: a failed write never put that there.
  // Only the visit that made it follows, since an older flush would land over text the buffer reopened without (#298, #303).
  // `ok` settles `saveFirst` (#306).
  #queued = new Map<string, Queued>();
  // Notes whose outside write was declined while ours were in the air, reloaded once they answer (#296).
  #missed = new Set<string>();
  // Bumped per write sent: orders held entries against the writes that fail after them.
  #saves = 0;
  // Bumped per note opened: tells a write whether its visit is still on screen.
  #visit = 0;
  // When each entry was held, so a failing write can tell newer text from the same buffer. In memory,
  // since the store keeps an unchanged entry's object.
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
   * The read rule's stale check on a read of `note` while a write to it is in the air.
   * True for that write's text, which the buffer now follows; false for text from before it, read again once the writes answer.
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
    // Declined outside writes are read now, once none of ours can land over them. The refetch answers later,
    // so the arm below settles this write before the editor asks.
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
    // Read before `#inAir.set` below replaces the entry: the keepalive names the last write sent, not one queued behind it (#310).
    // Only when the buffer follows the queue; a reopened or reloaded one was typed on other text.
    const air = this.#inAir.get(to);
    const ahead = this.#queued.get(to);
    const follows = ahead?.visit === opened && ahead.loaded === loaded;
    const before = follows ? sentUnder(air, loaded) : undefined;
    this.#writing.set(to, (this.#writing.get(to) ?? 0) + 1);
    // Set as the request goes out: a write queued behind another names what that one landed.
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
    // Leaving text goes into the cache, so a reopen shows it and not the older text (#303).
    const prior = queryClient.getQueryData<string>(["note", to]);
    if (leaving) queryClient.setQueryData(["note", to], content);
    // Held text is kept by path, and the note may move before this answers.
    const since = movesMade();
    // A failure without an HTTP status may follow a server write (#307), so the vault is read again.
    // Taken only when it holds this text: other text is somebody else's write.
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

    // Two arguments unless a base is named: the conflict overwrite names none.
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
      // Named, so a page going away cannot write over somebody else. Text typed behind a write in the air
      // names that write's text, which lands first, and the same text names its base.
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
      // Refused while the write ahead failed or was still in the air: `under` was a guess, so resend naming
      // what the vault holds (#305, #310). A refusal after the write ahead landed `under` is somebody else's write.
      // Not for a keepalive that named the base: the buffer was not typed on that write's text.
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
      // Queued too: the next write names this answer, and goes out after the write ahead.
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
      // Never rejects, so a failed write still lets the next one go.
      link = request.then(
        (note) => note.content,
        (failure: unknown) => (failure instanceof TypeError ? reread() : under),
      );
    }
    // Landing settles the failures before it. A write `:e!` threw away leaves the outcome to those.
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
    // Held and sent again with keepalive, since the flush to a note already left dies with the page too (#302).
    // Not after a reload of that note (#306), nor the vault's text `:e!` put back (#311).
    // A write still queued was never sent, and names the last one that was (#310).
    for (const [note, air] of [...this.#inAir]) {
      if (note === path || air.restoring || air.loaded !== this.reloadsOf(note)) {
        continue;
      }
      const { entry, under } = heldOf(air, "Not yet written when the page was hidden", false);
      holdText(note, entry);
      // On the visit it was typed in, so an older write failing behind it sees newer text and drops itself (#290).
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
