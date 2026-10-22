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
import { currentTheme } from "@/lib/theme";

/** A diagram as svg markup, or why it could not be drawn. */
export type Drawing = { svg: string } | { error: string };

/** Forgotten when it fails, so the next diagram asks again (#647). */
const loadMermaid = loadOnce(async (): Promise<Mermaid> => {
  // A dynamic import `.claude/CLAUDE.md` allows, as it does pdf.js and
  // KaTeX: mermaid is the heaviest bundle in the app, and
  // a static import would put it on every editor page whether or not a note
  // held a diagram.
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    // Thrown rather than drawn: mermaid's own error is a bomb picture left
    // in `document.body`, and the widget shows the message beside the source.
    suppressErrorRendering: true,
    // Read once, when mermaid loads: a switch after that redraws nothing until
    // #835, so a diagram keeps the theme it was first drawn in.
    theme: currentTheme() === "dark" ? "dark" : "default",
  });
  return mermaid;
});

/**
 * Every source drawn so far, and its drawing.
 *
 * Keyed by the text, so a block scrolled back into view or a note opened again
 * shows its diagram at once, and an undo brings back the drawing it undid.
 */
const drawings = new Map<string, Promise<Drawing>>();
const settled = new Map<string, Drawing>();
/** Mermaid works in a scratch element under this id, so no two may share one. */
let count = 0;

/** The drawing of `source` if it has landed, for a widget to show at once. */
export function drawnMermaid(source: string): Drawing | undefined {
  return settled.get(source);
}

/** Why a diagram could not be drawn, as the widget shows it. */
function failed(error: unknown): Drawing {
  if (!(error instanceof Error)) throw error;
  return { error: error.message };
}

export function drawMermaid(source: string): Promise<Drawing> {
  let drawing = drawings.get(source);
  if (drawing === undefined) {
    drawing = loadMermaid().then(
      (mermaid) =>
        mermaid
          .render(`kasten-mermaid-${++count}`, source)
          .then(({ svg }): Drawing => ({ svg }), failed)
          .then((done) => {
            settled.set(source, done);
            return done;
          }),
      // A failed load is not this diagram's fault, so it is not kept: the
      // next draw of the same source loads again (#647). A syntax error is
      // kept, since drawing it again would fail the same way.
      (error: unknown) => {
        drawings.delete(source);
        return failed(error);
      },
    );
    drawings.set(source, drawing);
  }
  return drawing;
}
