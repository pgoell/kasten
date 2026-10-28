import { useCallback, useEffect } from "react";
import { dropText, type Held, heldText, heldTexts, landedAs, sameText } from "@/lib/held-text";
import { type Buffer, wasLeftAloft } from "@/lib/note/held-buffer";
import { saveQueue } from "@/lib/note/save-queue";

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
      // before it would compare against the old one (`follow`). Only while
      // that write is the newest: text typed over it since is queued behind
      // it, and taking the older entry would land over that unasked.
      const air = saveQueue.air(note);
      if (
        wasLeftAloft(held) &&
        landedAs(held.content, text) &&
        (air === undefined || air.content === held.content)
      ) {
        if (taken.current === held) return true;
        onDisk.current = air === undefined ? text : (air.base ?? null);
        take(held);
        if (!opening.current) follow(note, held);
        return true;
      }
      if (saveQueue.busy(note)) return undefined;
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
      if (pending.current === null && path !== undefined) {
        const stale = saveQueue.staleRead(path, text);
        if (stale !== undefined) return stale;
      }
      // Taken into the buffer, so the vault under it is this text now, and the
      // next write names it as its base.
      if (pending.current === null) {
        onDisk.current = text;
        // Only text the screen lacks: the editor asks with the text it already
        // shows as well, and that replaces nothing.
        const doc = shownRef.current?.();
        if (path !== undefined && doc !== undefined && !sameText(doc, text)) {
          saveQueue.reload(path);
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
    if (path !== undefined && saveQueue.busy(path)) {
      saveQueue.miss(path);
      return false;
    }
    return pending.current === null || conflicted.current;
  }, [path, pending, conflicted]);

  // The leave flush in `useAutosave`, declared before this effect, still counts
  // as the visit it leaves: React runs the old render's cleanups before any of
  // the new render's setups.
  // Runs on each opening, a new pane on the same note included: `queryClient`
  // and `restore` never change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pane` is the trigger, and is not read.
  useEffect(() => {
    saveQueue.open();
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
    const air = path === undefined ? undefined : saveQueue.air(path);
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
      saveQueue.follow(path);
    }
    if (path !== undefined && cached !== undefined && held && doc !== undefined) {
      if (sameText(doc, held.content)) restore(path, cached);
    }
    // The leave's write the buffer took, which its sender no longer hears.
    if (path !== undefined && taken.current !== null && wasLeftAloft(taken.current)) {
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
