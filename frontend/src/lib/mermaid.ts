/**
 * ```` ```mermaid ```` blocks, drawn as diagrams.
 *
 * The widget that holds a diagram is in `live-preview-fences.ts`; this is what draws
 * it. Agents write these into notes, so a diagram is text kasten did not write:
 * mermaid runs at its strict level, which drops `click` handlers and passes
 * every label through DOMPurify.
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

/**
 * Every source drawn so far, and its drawing, per theme.
 *
 * Keyed by the theme and the text, so a block scrolled back into view or a note
 * opened again shows its diagram at once, and an undo brings back the drawing
 * it undid. A switch of theme draws the diagram again in the new theme.
 */
const drawings = new Map<string, Promise<Drawing>>();
const settled = new Map<string, Drawing>();
/** Mermaid works in a scratch element under this id, so no two may share one. */
let count = 0;

/** The drawing of `source` in `theme` if it has landed, for a widget to show at once. */
export function drawnMermaid(source: string, theme: Theme = currentTheme()): Drawing | undefined {
  return settled.get(`${theme}\n${source}`);
}

/** Why a diagram could not be drawn, as the widget shows it. */
function failed(error: unknown): Drawing {
  if (!(error instanceof Error)) throw error;
  return { error: error.message };
}

export function drawMermaid(source: string, theme: Theme = currentTheme()): Promise<Drawing> {
  const key = `${theme}\n${source}`;
  let drawing = drawings.get(key);
  if (drawing === undefined) {
    drawing = loadMermaid().then(
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
            settled.set(key, done);
            return done;
          }),
      // A failed load is not this diagram's fault, so it is not kept: the
      // next draw of the same source loads again (#647). A syntax error is
      // kept, since drawing it again would fail the same way.
      (error: unknown) => {
        drawings.delete(key);
        return failed(error);
      },
    );
    drawings.set(key, drawing);
  }
  return drawing;
}
