import type { QueryClient } from "@tanstack/react-query";
import { ChangedOnDisk, fetchNote, type Note, saveNote } from "@/lib/api";
import { dropText, type Held, holdText, landedAs, movesMade } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";

/** One fewer write in the air for `note`, taking the entry when it reaches none. */
function lower(counts: Map<string, number>, note: string): void {
  const left = (counts.get(note) ?? 0) - 1;
  if (left > 0) counts.set(note, left);
  else counts.delete(note);
}

/** A queued write a `:e!` threw away before its turn came, never sent (#301). */
export class Skipped extends Error {}

/** A note's newest write still to answer; see `inAir` below. */
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
export function unseenOf(air: InAir | undefined): InAir | undefined {
  const unseen = air?.unseen;
  return unseen !== undefined && air?.sent?.visit === unseen.visit ? unseen : undefined;
}

/**
 * The text the newest write to a note sent, which text typed behind it was
 * typed on. Not after a reload since, nor while that write is of a visit the
 * buffer never took: naming it would land over it unasked (#317).
 */
export function sentUnder(air: InAir | undefined, loaded: number): string | undefined {
  if (air?.sent?.loaded !== loaded || unseenOf(air) !== undefined) return undefined;
  return air.sent.content;
}

/** How many times a clean buffer of `note` took the vault's text in. */
export function reloadsOf(reloads: Map<string, number>, note: string): number {
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
export const dropped = { current: new Map<string, number>() };
// How many times a clean buffer took the vault's text in, which a failing
// write compares against the reading it left with: after one, the screen
// holds text not typed on the write's (#290). By note: a reload of the note
// opened next says nothing about the buffer a flush of this one left.
export const reloads = { current: new Map<string, number>() };
// The notes a write is on its way to, counted rather than flagged: `:w`
// during a quiet write puts two in the air for one note, and the first to
// answer must not read as the last. By path, because the tail this answers is
// the note just left: its text is still in flight while the hook has already
// moved on, and nothing else on the route can see that write.
export const writing = { current: new Map<string, number>() };
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
export const inAir = { current: new Map<string, InAir>() };
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
export const queued = { current: new Map<string, Queued>() };
// The notes whose outside write `reconcile` declined while a write to them
// was in the air, reloaded once the last of those writes answers (#296).
export const missed = { current: new Set<string>() };
// Bumped by every write that goes out, which orders held entries against
// the writes that fail after them (`heldAt`).
export const saves = { current: 0 };
// Bumped each time a note is opened, so a write knows whether the visit it
// was made in is still the one on screen.
export const visit = { current: 0 };
// The `saves` count and the visit when each entry was held, so a failing
// write can tell an entry held after it went out on the same buffer (newer
// text, the hide's) from one typed on other text. In memory: the store keeps
// an unchanged entry's object.
export const heldAt = { current: new WeakMap<Held, { seq: number; visit: number }>() };

/** A write of `to` answered: its count goes down, and the note's entry leaves the air when none is left. */
export function answered(to: string, queryClient: QueryClient): void {
  lower(writing.current, to);
  if (writing.current.has(to)) return;
  inAir.current.delete(to);
  // An outside write declined while this was in the air is read now,
  // once nothing of ours can land over it. The refetch answers later, so
  // the arm below settles this write before the editor asks.
  if (missed.current.delete(to)) {
    void queryClient.invalidateQueries({ queryKey: ["note", to] }, { cancelRefetch: false });
  }
}

/** Forget the writes of the page, as a new page starts with none. */
export function forgetWrites(): void {
  queued.current = new Map();
  inAir.current = new Map();
  writing.current = new Map();
  dropped.current = new Map();
  reloads.current = new Map();
  missed.current = new Set();
  saves.current = 0;
  visit.current = 0;
  heldAt.current = new WeakMap();
}

/** What a write of the buffer hands `enqueue`: the text sent and the state it was typed in. */
export interface Entry {
  to: string;
  content: string;
  keepalive: boolean;
  leaving: boolean;
  restoring: boolean;
  base: string | undefined;
  opened: number;
  loaded: number;
  kept: number;
  wasConflicted: boolean;
  air: InAir | undefined;
  ahead: Queued | undefined;
  follows: boolean;
  before: string | undefined;
  queryClient: QueryClient;
}

/** What `enqueue` leaves for the write's answer: the request and the queue's record of it. */
export interface Queueing {
  request: Promise<Note>;
  mine: Queued;
  prior: string | undefined;
  since: number;
  named: () => string | undefined;
  reread: () => Promise<string | undefined>;
}

export function enqueue(entry: Entry): Queueing {
  const {
    to,
    content,
    keepalive,
    leaving,
    restoring,
    base,
    opened,
    loaded,
    kept,
    wasConflicted,
    air,
    ahead,
    follows,
    before,
    queryClient,
  } = entry;
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
  queued.current.set(to, mine);
  void link.then(() => {
    if (queued.current.get(to)?.link === link) queued.current.delete(to);
  });
  return { request, mine, prior, since, named: () => named, reread };
}

/**
 * The flush of a note already left, and of the write still in the air for
 * each, when the page is hidden: each is held and sent again with keepalive.
 */
export function resendLeft(path: string | undefined): void {
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
}
