import { useCallback, useEffect } from "react";
import { dropText, type Held, heldText, heldTexts, landedAs, sameText } from "@/lib/held-text";
import { type Buffer, wasLeftAloft } from "@/lib/note/held-buffer";
import type { InAir } from "@/lib/note/in-air";
import { saveQueue } from "@/lib/note/save-queue";

function shows(doc: string | undefined, content: string | undefined): boolean {
  return doc !== undefined && content !== undefined && sameText(doc, content);
}

function showsOther(doc: string | undefined, content: string | undefined): boolean {
  return doc !== undefined && content !== undefined && !sameText(doc, content);
}

// A write another hook has in the air: the leave left its text in the cache, and a page closing would cancel it (#386).
// Taken, the bar leaves it out. Only while that write is the newest, since text typed over it queues behind it.
function landedAloft(held: Held, text: string, air: InAir | undefined): boolean {
  return (
    wasLeftAloft(held) &&
    landedAs(held.content, text) &&
    (air === undefined || air.content === held.content)
  );
}

// A vault moved past the buffer's base is somebody else's write, and held text must not go over it unasked.
// `landedAs`, since `after` is text a write sent.
function movedPast(held: Held, text: string): boolean {
  if (held.base === undefined || landedAs(held.base, text)) return false;
  return !(held.after !== undefined && landedAs(held.after, text));
}

/** Drops every entry held for `note` that the vault's `text` holds, and `also` with them. */
function dropLanded(note: string, text: string, also: Held | null = null): void {
  for (const entry of heldTexts(note)) {
    if (entry === also || landedAs(entry.content, text)) dropText(note, entry);
  }
}

function clearTimer(timer: Buffer["timer"]): void {
  if (timer.current) clearTimeout(timer.current);
  timer.current = null;
}

// The editor shows the cached text and asks nothing, so that is the base now. Not the text a write in the air sent:
// a buffer that never took it was typed on the text under it. One that takes it follows the write's answer (#303).
function baseOnOpen(cached: string | undefined, air: InAir | undefined): string | null {
  if (air !== undefined && cached !== undefined && sameText(cached, air.content)) {
    return air.base ?? null;
  }
  return cached ?? null;
}

function takeAloft(
  note: string,
  held: Held,
  text: string,
  air: InAir | undefined,
  buffer: Pick<Buffer, "taken" | "onDisk" | "take" | "opening">,
  follow: (note: string, held: Held) => void,
): void {
  if (buffer.taken.current === held) return;
  buffer.onDisk.current = air === undefined ? text : (air.base ?? null);
  buffer.take(held);
  if (!buffer.opening.current) follow(note, held);
}

function offerable(next: Held | undefined, doc: string | undefined): Held | undefined {
  return showsOther(doc, next?.content) ? undefined : next;
}

function leftAloft(entry: Held | null): entry is Held {
  return entry !== null && wasLeftAloft(entry);
}

/** Takes `held` into the buffer as text not saved, a conflict when the vault moved past its base. */
function holdTaken(
  held: Held,
  text: string,
  buffer: Pick<Buffer, "pending" | "take" | "conflicted" | "setStatus" | "setReason">,
): void {
  buffer.pending.current = held.content;
  buffer.take(held);
  buffer.conflicted.current = held.conflicted || movedPast(held, text);
  buffer.setStatus(buffer.conflicted.current ? "conflict" : "error");
  buffer.setReason(held.reason);
}

// Both undefined while no note is open.
function openingReads(path: string | undefined, queryClient: Buffer["queryClient"]) {
  if (path === undefined) return { cached: undefined, air: undefined };
  return { cached: queryClient.getQueryData<string>(["note", path]), air: saveQueue.air(path) };
}

function heldFor(path: string | undefined, cached: string | undefined): Held | undefined {
  return path === undefined ? undefined : heldText(path, cached);
}

/** A clean buffer takes the vault's `text`, unless it is a stale read under a write in the air. */
function takeClean(
  path: string | undefined,
  text: string,
  onDisk: Buffer["onDisk"],
  shownRef: Buffer["shownRef"],
): boolean {
  // While a write to the note is in the air, a read of the text under it is a step behind the screen (#304): declined,
  // and the note reloads once the write answers. A buffer that takes the sent text was typed on it (#303).
  // Other text goes in as a reload (#297, #298). Not after `:e!`, which took the note out of the air.
  if (path !== undefined) {
    const stale = saveQueue.staleRead(path, text);
    if (stale !== undefined) return stale;
  }
  // Taken into the buffer, so the vault under it is this text, and the next write names it as its base.
  onDisk.current = text;
  // Only text the screen lacks: a reload asks with the text it shows, and that replaces nothing.
  if (path !== undefined && showsOther(shownRef.current?.(), text)) saveQueue.reload(path);
  return true;
}

/** What the buffer takes in from the vault and the held store, as the vault's text comes and goes. */
export function useVaultReads(
  buffer: Buffer,
  path: string | undefined,
  pane: string | undefined,
  follow: (note: string, held: Held) => void,
) {
  const {
    pending,
    timer,
    onDisk,
    conflicted,
    taken,
    opening,
    offered,
    shownRef,
    take,
    setStatus,
    setReason,
    queryClient,
  } = buffer;

  /**
   * Take the text held for `note` into the buffer, against the vault's `text`. Answers as `allowReload` would,
   * or undefined when nothing is taken. Only into a clean buffer with no write in the air. Nothing is written on take.
   */
  const restore = useCallback(
    (note: string, text: string): boolean | undefined => {
      const held = heldText(note, text);
      if (!held || pending.current !== null) return undefined;
      if (!opening.current && held !== offered.current) return undefined;
      const air = saveQueue.air(note);
      if (landedAloft(held, text, air)) {
        takeAloft(note, held, text, air, { taken, onDisk, take, opening }, follow);
        return true;
      }
      if (saveQueue.busy(note)) return undefined;
      // Every entry the vault holds by now has landed, whichever write it was.
      dropLanded(note, text);
      // The editor opened on the note's oldest, so only that one can be taken.
      // When it landed, the next waits on the bar for the next opening.
      // Opened before the vault's text came, on an entry that belongs to another note. Taking it would leave `pending`
      // showing text the screen lacks. So the vault's text goes in, and the entry waits for the next opening.
      if (landedAs(held.content, text) || showsOther(shownRef.current?.(), held.content)) {
        onDisk.current = text;
        return true;
      }
      holdTaken(held, text, { pending, take, conflicted, setStatus, setReason });
      return false;
    },
    [
      take,
      follow,
      pending,
      opening,
      offered,
      onDisk,
      taken,
      conflicted,
      setStatus,
      setReason,
      shownRef,
    ],
  );

  /**
   * Whether the editor may put `text` in, asked when it would. A clean buffer takes anything: that is the reload's job.
   * A buffer with text in it takes nothing. Held text also comes back here, before the hook's own effect runs for a reopened note.
   */
  const allowReload = useCallback(
    (text: string): boolean => {
      const restored = path === undefined ? undefined : restore(path, text);
      if (restored !== undefined) return restored;
      if (pending.current === null) return takeClean(path, text, onDisk, shownRef);
      // The vault holds what the buffer holds, so a conflict over it, and a held copy, is over.
      // Only that entry goes: one a failed flush held after a reopen holds text the buffer never showed.
      if (!landedAs(pending.current, text)) return false;
      onDisk.current = text;
      pending.current = null;
      conflicted.current = false;
      clearTimer(timer);
      if (path !== undefined) dropLanded(path, text, taken.current);
      take(null);
      setStatus("saved");
      setReason(undefined);
      return true;
    },
    [
      path,
      restore,
      take,
      pending,
      timer,
      onDisk,
      taken,
      conflicted,
      setStatus,
      setReason,
      shownRef,
    ],
  );

  /**
   * Called when the vault reports a write to the open note: yes for a clean buffer, no for a dirty one.
   * No while a write to the note is in the air (#296), and yes for a conflicted buffer too (#269).
   */
  const reconcile = useCallback((): boolean => {
    if (path !== undefined && saveQueue.busy(path)) {
      saveQueue.miss(path);
      return false;
    }
    return pending.current === null || conflicted.current;
  }, [path, pending, conflicted]);

  // The leave flush in `useAutosave` still counts as the visit it leaves: React runs old cleanups before new setups.
  // Runs on each opening, a new pane on the same note included.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pane` is the trigger, and is not read.
  useEffect(() => {
    saveQueue.open();
    // An editor that stayed mounted asks nothing on the way back, so its held text is taken here, and only when it shows that text.
    // A second pane on the note showing the vault's text would otherwise send that text plus a keystroke.
    const { cached, air } = openingReads(path, queryClient);
    onDisk.current = baseOnOpen(cached, air);
    // Against the cached text, as the editor's `held` reads it, so another note's entry is passed over.
    const held = heldFor(path, cached);
    const doc = shownRef.current?.();
    if (path !== undefined) {
      // A standby pane took the sent text through the route's own reload and asks nothing on the way in, so the follow is made here (#303).
      if (shows(doc, air?.content)) saveQueue.follow(path);
      if (cached !== undefined && shows(doc, held?.content)) restore(path, cached);
      // The leave's write the buffer took, which its sender no longer hears.
      if (leftAloft(taken.current)) follow(path, taken.current);
    }
    // An editor still to mount opens on the entry held now, and only that one is taken when it asks (`opening`).
    // An editor already showing other text never takes it this visit.
    const next = heldFor(path, cached);
    offered.current = offerable(next, doc);
    opening.current = false;
    // The flush of the note left set `saving` and never answers here, so the reading starts again for the note opened.
    if (pending.current === null) {
      setStatus("saved");
      setReason(undefined);
    }
  }, [
    path,
    pane,
    queryClient,
    restore,
    follow,
    onDisk,
    shownRef,
    taken,
    offered,
    opening,
    pending,
    setStatus,
    setReason,
  ]);

  return { allowReload, reconcile };
}
