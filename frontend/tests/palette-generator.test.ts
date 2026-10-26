/// <reference types="node" />

import { existsSync, readFileSync } from "node:fs";
import {
  checks,
  closePairs,
  css,
  type Measures,
  type PaletteId,
  statusTagClose,
  type Theme,
  table,
} from "../scripts/palettes";

/** A file that is not there reads as empty, so a missing page fails its comparison and does not throw. */
function read(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

const CSS_PATH = "src/styles/kasten-theme.css";
const DOCS_PATH = "../docs/reference/accent-palettes.md";
const CSS_BEGIN = "/* palettes:begin: written by scripts/palettes.ts, do not edit by hand */";
const CSS_END = "/* palettes:end */";
const DOCS_BEGIN = "<!-- palettes:begin -->";
const DOCS_END = "<!-- palettes:end -->";

/** The text between two markers, with the line breaks at each edge taken off; "" when a marker is missing. */
function between(text: string, begin: string, end: string): string {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (start < 0 || stop < 0) return "";
  return text
    .slice(start + begin.length, stop)
    .replace(/^\n/, "")
    .replace(/\n$/, "");
}

const round = (n: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(n * scale) / scale;
};

/** The issue's bar for each text pair, by theme. Every other pair is 4.5. */
function bar(theme: Theme, key: Exclude<keyof Measures, "highestChroma">): number {
  if (theme === "light" && key === "accentOnPaper") return 5;
  if (theme === "light" && key === "accentOnSurface") return 4.6;
  if (theme === "dark" && key === "accentOnPaper") return 6;
  return 4.5;
}

/** "ok" at or over the bar, else the number, rounded to two places. */
const grade = (value: number, floor: number) => (value >= floor ? "ok" : round(value, 2));

const PAIRS = [
  "accentOnPaper",
  "accentOnSurface",
  "linkOnPaper",
  "accentOnWash",
  "inkOnHighlight",
  "linkOnHighlight",
  "mutedOnHighlight",
  "lowestStatus",
  "lowestTag",
] as const;

/** Every pair at its bar. Each miss below is an issue value kept on purpose. */
const OK = {
  accentOnPaper: "ok",
  accentOnSurface: "ok",
  linkOnPaper: "ok",
  accentOnWash: "ok",
  inkOnHighlight: "ok",
  linkOnHighlight: "ok",
  mutedOnHighlight: "ok",
  lowestStatus: "ok",
  lowestTag: "ok",
};

test("every palette's status and tag hues sit at least 20 degrees apart", () => {
  // Every pair under 20 degrees, in light hue. Each one is there because the
  // pool had no colour left that sat farther from the slots picked before it.
  expect(closePairs()).toEqual({
    russet: [
      // A fallback slot: no colour left sat 20 degrees from every earlier pick.
      { pair: ["--tg-1", "--tg-9"], gap: 17.7 },
      // A fallback slot, as above.
      { pair: ["--tg-4", "--tg-9"], gap: 12.9 },
      // A fallback slot, as above.
      { pair: ["--tg-5", "--tg-8"], gap: 16.5 },
      // A fallback slot, as above.
      { pair: ["--tg-6", "--tg-10"], gap: 12.6 },
    ],
    peach: [
      // A fallback slot, as above.
      { pair: ["--tg-5", "--tg-10"], gap: 18 },
    ],
    pansy: [
      // A fallback slot. Every colour left sat under 20 degrees from danger, so the farthest went in.
      { pair: ["--k-danger", "--tg-10"], gap: 14.7 },
      // A fallback slot, as above.
      { pair: ["--tg-1", "--tg-6"], gap: 8.6 },
      // A fallback slot, as above.
      { pair: ["--tg-2", "--tg-8"], gap: 4.5 },
      // A fallback slot, as above.
      { pair: ["--tg-2", "--tg-9"], gap: 4 },
      // A fallback slot, as above.
      { pair: ["--tg-3", "--tg-5"], gap: 10.1 },
      // A fallback slot, as above.
      { pair: ["--tg-4", "--tg-7"], gap: 5 },
      // A fallback slot, as above.
      { pair: ["--tg-8", "--tg-9"], gap: 0.5 },
    ],
  });
});

/** One grade per palette and theme, in the shape the expectations read. */
const PALETTE_IDS = ["poel", "russet", "peach", "pansy"] as const;
function byPaletteAndTheme<T>(grade: (id: PaletteId, theme: Theme) => T) {
  return Object.fromEntries(
    PALETTE_IDS.map((id) => [id, { light: grade(id, "light"), dark: grade(id, "dark") }]),
  );
}

test("every palette's danger sits 60 degrees of hue or 0.08 of lightness from its accent, light and dark", () => {
  // A red accent leaves no hue room for danger, so danger steps darker by lightness instead.
  const measured = checks();
  const grade = (id: PaletteId, theme: Theme) => {
    const m = measured[id][theme];
    return m.dangerGap >= 60 || m.dangerLightGap >= 0.08
      ? "ok"
      : { hue: round(m.dangerGap, 1), light: round(m.dangerLightGap, 3) };
  };
  expect(byPaletteAndTheme(grade)).toEqual({
    poel: { light: "ok", dark: "ok" },
    russet: { light: "ok", dark: "ok" },
    peach: { light: "ok", dark: "ok" },
    pansy: { light: "ok", dark: "ok" },
  });
});

test("every palette's danger reads red and sits at least 20 degrees in hue from warn, light and dark", () => {
  // Red runs from 340 round to 45 degrees, so an overdue date reads as an error, not a warning.
  const measured = checks();
  const grade = (id: PaletteId, theme: Theme) => {
    const m = measured[id][theme];
    const red = m.dangerHue >= 340 || m.dangerHue <= 45;
    return red && m.dangerWarnGap >= 20
      ? "ok"
      : { hue: round(m.dangerHue, 1), warn: round(m.dangerWarnGap, 1) };
  };
  expect(byPaletteAndTheme(grade)).toEqual({
    poel: { light: "ok", dark: "ok" },
    russet: { light: "ok", dark: "ok" },
    peach: { light: "ok", dark: "ok" },
    pansy: { light: "ok", dark: "ok" },
  });
});

test("no tag sits under 20 degrees in hue from a status colour, in any palette, light and dark", () => {
  // A tag near a status colour is the wrong signal. Each pair listed is one the pool could not clear.
  const close = statusTagClose();
  expect(byPaletteAndTheme((id, theme) => close[id][theme])).toEqual({
    // Poel's values are 0.83.0's own, copied from :root, so the generator never picks them.
    poel: {
      light: [
        ["--k-ok", "--tg-9", 0.2],
        ["--k-warn", "--tg-8", 12.4],
        ["--k-info", "--tg-3", 0.7],
        ["--k-danger", "--tg-1", 13.7],
      ],
      dark: [
        ["--k-ok", "--tg-9", 0.3],
        ["--k-warn", "--tg-8", 12.3],
        ["--k-info", "--tg-3", 0.2],
        ["--k-danger", "--tg-1", 13.5],
      ],
    },
    russet: { light: [], dark: [] },
    peach: { light: [], dark: [] },
    // A fallback slot: every colour left sat under 20 degrees from danger, so the farthest went in.
    pansy: {
      light: [["--k-danger", "--tg-10", 14.7]],
      dark: [["--k-danger", "--tg-10", 14.6]],
    },
  });
});

test("every palette's warn sits at least 60 degrees in hue from its accent, light and dark", () => {
  // Accent and warn sit near the same contrast on paper and chroma is capped, so
  // hue is the only axis left to tell them apart. 60 degrees is one sixth of the wheel.
  const measured = checks();
  const grade = (id: keyof typeof measured, theme: Theme) => {
    const gap = measured[id][theme].warnGap;
    return gap >= 60 ? "ok" : round(gap, 1);
  };
  expect({
    poel: { light: grade("poel", "light"), dark: grade("poel", "dark") },
    russet: { light: grade("russet", "light"), dark: grade("russet", "dark") },
    peach: { light: grade("peach", "light"), dark: grade("peach", "dark") },
    pansy: { light: grade("pansy", "light"), dark: grade("pansy", "dark") },
  }).toEqual({
    poel: { light: "ok", dark: "ok" },
    russet: { light: "ok", dark: "ok" },
    peach: { light: "ok", dark: "ok" },
    pansy: { light: "ok", dark: "ok" },
  });
});

test("the generator's css is the palette blocks in kasten-theme.css", () => {
  expect(between(read(CSS_PATH), CSS_BEGIN, CSS_END)).toEqual(css());
});

test("the generator's table is the one in the docs", () => {
  expect(between(read(DOCS_PATH), DOCS_BEGIN, DOCS_END)).toEqual(table());
});

test("every palette meets the issue's bars, the issue's own misses named", () => {
  const measured = checks();
  const palettes = ["poel", "russet", "peach", "pansy"] as const;
  const themes = ["light", "dark"] as const;
  const graded = Object.fromEntries(
    palettes.map((id) => [
      id,
      Object.fromEntries(
        themes.map((theme) => {
          const m = measured[id][theme];
          const row: Record<string, unknown> = Object.fromEntries(
            PAIRS.map((key) => [key, grade(m[key], bar(theme, key))]),
          );
          // Poel is pinned to 0.83.0 and has no chroma cap to meet; the other three do.
          if (id !== "poel") {
            const cap = theme === "light" ? 0.12 : 0.1;
            row.highestChroma = m.highestChroma <= cap ? "ok" : round(m.highestChroma, 3);
          }
          return [theme, row];
        }),
      ),
    ]),
  );
  expect(graded).toEqual({
    // Poel's lowest tag on the light background is 4.09, the value 0.83.0 paints.
    poel: {
      light: { ...OK, lowestTag: 4.09 },
      // Muted text on the dark highlight is 3.98: the #777 exception.
      dark: { ...OK, mutedOnHighlight: 3.98 },
    },
    // The dark highlights are the issue's values, kept, so muted text on them
    // misses; peach and pansy also miss with link text on them.
    russet: {
      light: { ...OK, highestChroma: "ok" },
      dark: { ...OK, highestChroma: "ok", mutedOnHighlight: 3.7 },
    },
    peach: {
      light: { ...OK, highestChroma: "ok" },
      dark: { ...OK, highestChroma: "ok", linkOnHighlight: 4.48, mutedOnHighlight: 3.56 },
    },
    pansy: {
      light: { ...OK, highestChroma: "ok" },
      dark: { ...OK, highestChroma: "ok", linkOnHighlight: 4.17, mutedOnHighlight: 3.34 },
    },
  });
});
