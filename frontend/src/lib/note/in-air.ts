import type { Held } from "@/lib/held-text";

// The last text sent to each note while a write to it is in the air. A hide
// holds and resends it from here, since a plain fetch dies with the page (#302).
// `stale` keeps every such write's base and named text: a read may answer with one (#304).
// `sent` is the newest write that went out. A write queued behind it never reached the vault (#310).
// `restoring` marks a `:e!` write that nobody typed, so a hide neither holds nor sends it (#311).
// `unseen` is the write ahead that a reopened buffer never took (#317).
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
