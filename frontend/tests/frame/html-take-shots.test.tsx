/**
 * Pictures of a take (#787), to look at by eye: the take button over a selection,
 * the toast right after a take, and the mark once the toast has faded. A
 * newspaper that opts in to kasten's theme, shot at 1440 by 900 and at 390 by 844
 * with touch in light and dark, the opted-in mark in the three accent palettes,
 * and a plain page's mark at 1440 in both themes.
 *
 * Skipped unless VITE_KASTEN_SHOTS=1; pictures land in node_modules/.cache/kasten-shots.
 */

import "./html-take-api";
// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { page as browserPage, commands, userEvent } from "vitest/browser";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import {
  frameOf,
  type Mounted,
  ready,
  render,
  select,
  setUp,
  takeButton,
  tearDown,
} from "./html-take-fixture";
import { page as htmlPage } from "./html-take-pages";
import { shot } from "./shots";

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";
const DESKTOP = { width: 1440, height: 900, touch: false };
const TOUCH = { width: 390, height: 844, touch: true };
type Size = typeof DESKTOP;

/** A newspaper that opts in and writes its look in tokens only, with two stories. */
const NEWS = htmlPage(
  "Evals",
  `<main style="max-width:680px;margin:0 auto">
<article id="2026-10-07-evals-01"><a class="sid" href="#2026-10-07-evals-01">#2026-10-07-evals-01</a><h2>Two evals disagree on the same model</h2><p>The rubric scores a model higher when its answers are long, and the human panel does not agree with the rubric on which answers are long enough.</p><p>Re-running the set with a fixed length cap moves the ranking by two places.</p></article>
<article id="2026-10-07-evals-02"><a class="sid" href="#2026-10-07-evals-02">#2026-10-07-evals-02</a><h2>Replication lag across three regions</h2><p id="p2" data-testid="p2">Replicas in Frankfurt and Virginia stay within one second of the primary at the 99th percentile. The Singapore replicas do not, and the gap grows with write volume.</p><p>Most of the lag sits in the apply queue, not on the wire. A replica that receives a burst of writes takes longer to apply them than the network takes to deliver them.</p></article>
<div style="height:1200px"></div></main>`,
  `<meta name="kasten-theme" content="tokens"><style>
  body { margin: 0; padding: 40px 56px; background: var(--k-bg); color: var(--k-ink); font: 17px/1.65 Georgia, serif; }
  .sid { font: 12px monospace; color: var(--k-muted); }
  h2 { font-size: 26px; font-weight: 500; margin: 18px 0 8px; }
  article { margin-bottom: 40px; }
  p { margin: 0 0 14px; }
</style>`,
);

/** A page of its own: no kasten meta, a heading and two paragraphs. */
const PLAIN = htmlPage(
  "Replication lag across three regions",
  `<main style="max-width:680px;margin:0 auto;padding:40px 56px;font:17px/1.6 Georgia,serif;color:#222;background:#fff">
<h1 style="font-size:30px;margin:0 0 12px">Replication lag across three regions</h1>
<p id="p1" data-testid="p1">Replicas in Frankfurt and Virginia stay within one second of the primary at the 99th percentile. The Singapore replicas do not.</p>
<p>Most of the lag sits in the apply queue, not on the wire.</p>
<div style="height:1200px"></div></main>`,
);

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

type Step = "selection" | "toast" | "marked";
type Range = [string, number, string, number];

/**
 * Takes one passage at `size` and `theme`, and shoots it at the step asked for:
 * the button over the selection, the toast after the take, or the mark once the
 * toast has faded on its own (the toast's own timer, 5 seconds then a fade).
 */
async function shootTake(
  name: string,
  size: Size,
  theme: Theme,
  source: { path: string; html: string },
  range: Range,
  step: Step,
  palette = "poel",
) {
  const mounted: Mounted = await setUp();
  try {
    await browserPage.viewport(size.width, size.height);
    await commands.emulateMedia({
      touch: size.touch,
      reducedMotion: "no-preference",
      contrast: "no-preference",
      reducedTransparency: "no-preference",
    });
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(PALETTE_KEY, palette);
    applyTheme();
    await commands.servePage(source.path, source.html);
    render(mounted, [source.path]);
    const frame = frameOf(mounted, 0);
    await ready(frame);

    await select(frame, range);
    await expect.poll(() => takeButton(mounted) !== null).toBe(true);
    if (step !== "selection") {
      await userEvent.keyboard("y");
      await expect.poll(() => mounted.host.querySelector("[role='status']") !== null).toBe(true);
    }
    if (step === "marked") {
      await expect
        .poll(() => mounted.host.querySelector("[role='status']") === null, { timeout: 10_000 })
        .toBe(true);
    }
    await document.fonts.ready;
    await nextFrame();

    const width = await shot(mounted.host, name);
    expect(width).toBe(size.width);
  } finally {
    await tearDown(mounted);
  }
}

function shotTest(name: string, run: () => Promise<void>) {
  it.skipIf(!SHOTS)(name, run, 300_000);
}

const NEWS_PATH = "take-shot-news.html";
const PLAIN_PATH = "take-shot-plain.html";
const NEWS_RANGE: Range = ["p2", 0, "p2", 40];
const PLAIN_RANGE: Range = ["p1", 0, "p1", 60];

for (const size of [DESKTOP, TOUCH]) {
  for (const theme of ["light", "dark"] as const) {
    for (const step of ["selection", "toast", "marked"] as const) {
      const name = `html-take-${step}-${size.width}-${theme}`;
      shotTest(name, () =>
        shootTake(name, size, theme, { path: NEWS_PATH, html: NEWS }, NEWS_RANGE, step),
      );
    }
  }
}

for (const theme of ["light", "dark"] as const) {
  const name = `html-take-marked-plain-1440-${theme}`;
  shotTest(name, () =>
    shootTake(name, DESKTOP, theme, { path: PLAIN_PATH, html: PLAIN }, PLAIN_RANGE, "marked"),
  );
  for (const palette of ["russet", "peach", "pansy"]) {
    const paletteName = `html-take-marked-palette-${palette}-1440-${theme}`;
    shotTest(paletteName, () =>
      shootTake(
        paletteName,
        DESKTOP,
        theme,
        { path: NEWS_PATH, html: NEWS },
        NEWS_RANGE,
        "marked",
        palette,
      ),
    );
  }
}
