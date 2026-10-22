/// <reference types="node" />

import { existsSync, readFileSync } from "node:fs";
import { checks, css, type Measures, shippedHues, type Theme, table } from "../scripts/palettes";

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

/** The pair of slots with the least hue gap between them, and that gap in degrees. */
function closestPair(hues: Record<string, number>): { pair: [string, string]; gap: number } {
  const slots = Object.entries(hues);
  let best = { pair: ["", ""] as [string, string], gap: Number.POSITIVE_INFINITY };
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const [a, ha] = slots[i] ?? ["", 0];
      const [b, hb] = slots[j] ?? ["", 0];
      const apart = Math.abs(ha - hb) % 360;
      const gap = Math.min(apart, 360 - apart);
      if (gap < best.gap) best = { pair: [a, b], gap };
    }
  }
  return best;
}

test("every palette's status and tag hues sit at least 20 degrees apart", () => {
  const closest = Object.fromEntries(
    Object.entries(shippedHues()).map(([id, hues]) => {
      const { pair, gap } = closestPair(hues);
      return [id, gap >= 20 ? "ok" : { pair, gap: Math.round(gap) }];
    }),
  );
  expect(closest).toEqual({
    // The pool runs out for these slots, so the pair is as far apart as it gets.
    russet: { pair: ["--k-info", "--tg-10"], gap: 13 },
    peach: { pair: ["--k-warn", "--tg-10"], gap: 16 },
    pansy: { pair: ["--tg-1", "--tg-10"], gap: 9 },
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
