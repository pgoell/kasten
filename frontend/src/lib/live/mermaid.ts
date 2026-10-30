/**
 * ```` ```mermaid ```` blocks, drawn as diagrams.
 * Agents write these, so mermaid runs at its strict level, which drops `click` handlers and passes labels through DOMPurify.
 */

import type { Mermaid } from "mermaid";
import { loadOnce } from "@/lib/load-once";
import { currentTheme, type Theme } from "@/lib/theme";

/** A diagram as svg markup, or why it could not be drawn. */
export type Drawing = { svg: string } | { error: string };

/** Forgotten when it fails, so the next diagram asks again (#647). */
const loadMermaid = loadOnce(async (): Promise<Mermaid> => {
  // A dynamic import `.claude/CLAUDE.md` allows, as it does pdf.js and
  // KaTeX: mermaid is the heaviest bundle in the app, and
  // a static import would put it on every editor page whether or not a note
  // held a diagram.
  const { default: mermaid } = await import("mermaid");
  return mermaid;
});

/**
 * Mermaid's config is one global, so each draw sets its theme and renders
 * before the next draw starts. Two draws of one source in two themes at once
 * then each get their own theme (#835). A draw that throws still ends its
 * turn, so the chain never stops.
 */
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = turn.then(work);
  turn = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** The drawings kept besides those on screen: the last few notes, the theme just left and an undo. A few MB at most. */
const RECENT = 32;

type Entry = { drawing: Promise<Drawing>; done?: Drawing };

/**
 * The sources drawn lately, per theme, least recently used first.
 * A diagram on screen is held (`holdMermaid`) and never evicted.
 */
const cache = new Map<string, Entry>();
/** How many widgets hold each key on screen. */
const held = new Map<string, number>();
/** Mermaid works in a scratch element under this id, so no two may share one. */
let count = 0;

function keyOf(source: string, theme: Theme): string {
  return `${theme}\n${source}`;
}

/** Moves a key to the end, so the first entries are the least recently used. */
function touch(key: string, entry: Entry) {
  cache.delete(key);
  cache.set(key, entry);
}

/** Drops the least recently used entries that no widget holds, while more than `RECENT` are left. */
function evict() {
  let unheld = 0;
  for (const key of cache.keys()) if (!held.has(key)) unheld++;
  for (const key of cache.keys()) {
    if (unheld <= RECENT) return;
    if (held.has(key)) continue;
    cache.delete(key);
    unheld--;
  }
}

/** Marks `source` in `theme` as on screen, so it is not evicted. The result releases the mark, once. */
export function holdMermaid(source: string, theme: Theme): () => void {
  const key = keyOf(source, theme);
  held.set(key, (held.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (held.get(key) ?? 1) - 1;
    if (left > 0) {
      held.set(key, left);
    } else {
      held.delete(key);
      // A drawing just off screen is what an undo or a switch back asks for next, so it is the last to go.
      const entry = cache.get(key);
      if (entry !== undefined) touch(key, entry);
    }
    evict();
  };
}

/** The drawing of `source` in `theme` if it has landed, for a widget to show at once. */
export function drawnMermaid(source: string, theme: Theme = currentTheme()): Drawing | undefined {
  const key = keyOf(source, theme);
  const entry = cache.get(key);
  const done = entry?.done;
  if (entry === undefined || done === undefined) return undefined;
  touch(key, entry);
  return done;
}

/** Why a diagram could not be drawn, as the widget shows it. */
function failed(error: unknown): Drawing {
  if (!(error instanceof Error)) throw error;
  return { error: error.message };
}

export function drawMermaid(source: string, theme: Theme = currentTheme()): Promise<Drawing> {
  const key = keyOf(source, theme);
  const hit = cache.get(key);
  if (hit !== undefined) {
    touch(key, hit);
    return hit.drawing;
  }
  const entry: Entry = {
    drawing: loadMermaid().then(
      (mermaid) =>
        inTurn(() => {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            // Thrown rather than drawn: mermaid's own error is a bomb picture left
            // in `document.body`, and the widget shows the message beside the source.
            suppressErrorRendering: true,
            theme: theme === "dark" ? "dark" : "default",
          });
          return mermaid.render(`kasten-mermaid-${++count}`, source);
        })
          .then(({ svg }): Drawing => ({ svg }), failed)
          .then((done) => {
            // An entry evicted while it ran is not written back, so it stays gone.
            if (cache.get(key) === entry) entry.done = done;
            return done;
          }),
      // A failed load is not this diagram's fault, so it is not kept: the
      // next draw of the same source loads again (#647). A syntax error is
      // kept, since drawing it again would fail the same way.
      (error: unknown) => {
        if (cache.get(key) === entry) cache.delete(key);
        return failed(error);
      },
    ),
  };
  cache.set(key, entry);
  evict();
  return entry.drawing;
}
