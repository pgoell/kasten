import type { Held } from "@/lib/held-text";

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
export interface InAir {
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

/**
 * The entry a hide holds of the text in the air, and the text its keepalive
 * names: the text the last write sent when that is not this text, the text
 * this one named when it went out, the base it was typed on otherwise. Only
 * a write sent since the reload this was typed after counts as sent.
 */
export function heldOf(
  air: InAir,
  reason: string,
  conflicted: boolean,
): { entry: Held; under: string | undefined } {
  const out = air.sent?.loaded === air.loaded ? air.sent : undefined;
  const under =
    out === undefined
      ? air.base
      : out.content === air.content
        ? (air.named ?? air.base)
        : out.content;
  const entry: Held = {
    content: air.content,
    reason,
    conflicted,
    base: air.base,
    after: under !== air.base ? under : undefined,
  };
  return { entry, under };
}
