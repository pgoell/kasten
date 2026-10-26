/**
 * The optional accent palettes of #778, and the generator that writes them.
 *
 * `kasten-theme.css` holds one block per palette and theme, and each block sets
 * the same 19 names. Poel's block copies the values `:root` already has, so it
 * stays what 0.83.0 paints. The other three take their accent and highlight from
 * the issue's table, and their status and tag colours from the Wada colours that
 * sit near their numbers.
 *
 * Run from frontend/: `bun scripts/palettes.ts` prints the CSS for the region
 * between the markers in kasten-theme.css, then the tables for the docs page.
 * The tests hold both to the files, so a hand edit to either one fails them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { BLACK, colour, hexRgb, hueGap, type RGB, ratio, rgbToLch } from "./colour";
import {
  at,
  CAP,
  GENERATED,
  type GeneratedId,
  generated,
  MIN_APART,
  SLOTS,
  STATUS,
  TAGS,
  THEMES,
  type Theme,
  type TokenSet,
  type Tokens,
  WARN_APART,
} from "./palette-picks";

const THEME_CSS = path.join(import.meta.dirname, "..", "src", "styles", "kasten-theme.css");

export const PALETTES = ["poel", "russet", "peach", "pansy"] as const;
export type PaletteId = (typeof PALETTES)[number];
export { THEMES, type Theme };

/** The 19 names, in the order each block writes them. */
export const NAMES = [
  "--k-accent",
  "--k-link",
  "--k-accent-wash",
  "--k-highlight",
  "--k-mark",
  ...STATUS,
  ...TAGS,
];

function declarations(body: string): Tokens {
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
}

/** The light `:root` and the dark `[data-theme="dark"]` blocks, read off the file. */
function themeBlocks(css: string): Record<Theme, Tokens> {
  const root = /^:root\s*{([^}]*)}/m.exec(css);
  const dark = /^\[data-theme="dark"\]\s*{([^}]*)}/m.exec(css);
  return { light: declarations(root?.[1] ?? ""), dark: declarations(dark?.[1] ?? "") };
}

/**
 * The light hue of each slot of a generated palette, as the file paints it. A
 * missing block falls back to poel, so a test reads a wrong hue, not a throw.
 */
export function shippedHues(): Record<GeneratedId, Record<string, number>> {
  const css = readFileSync(THEME_CSS, "utf8");
  const base = themeBlocks(css);
  const ids = Object.keys(GENERATED) as GeneratedId[];
  return Object.fromEntries(
    ids.map((id) => {
      const light = { ...base.light, ...paletteBlock(css, id, "light") };
      return [
        id,
        Object.fromEntries(SLOTS.map((slot) => [slot, rgbToLch(hexRgb(at(light, slot))).h])),
      ];
    }),
  ) as Record<GeneratedId, Record<string, number>>;
}

/** Two slots of one palette whose light hues sit under MIN_APART degrees apart. */
export interface ClosePair {
  pair: [string, string];
  gap: number;
}

/** Every pair of a palette's slots under MIN_APART, in slot order, with the gap to a tenth of a degree. */
function pairsUnder(hues: Record<string, number>): ClosePair[] {
  const slots = Object.entries(hues);
  const out: ClosePair[] = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const [a, ha] = slots[i] ?? ["", 0];
      const [b, hb] = slots[j] ?? ["", 0];
      const apart = Math.abs(ha - hb) % 360;
      const gap = Math.min(apart, 360 - apart);
      if (gap < MIN_APART) out.push({ pair: [a, b], gap: Math.round(gap * 10) / 10 });
    }
  }
  return out;
}

/** The close pairs of each generated palette, read off the file, so the docs and the test share them. */
export function closePairs(): Record<GeneratedId, ClosePair[]> {
  return Object.fromEntries(
    Object.entries(shippedHues()).map(([id, hues]) => [id, pairsUnder(hues)]),
  ) as Record<GeneratedId, ClosePair[]>;
}

/** What a palette block in the file sets for one theme; a missing block sets nothing. */
function paletteBlock(css: string, id: PaletteId, theme: Theme): Tokens {
  const blocks = css.matchAll(
    /^\[data-palette="([\w-]+)"\]((?:\[data-theme="dark"\])?)\s*{([^}]*)}/gm,
  );
  for (const m of blocks) {
    if (m[1] === id && (m[2] !== "") === (theme === "dark")) return declarations(m[3] ?? "");
  }
  return {};
}

/** Poel's values are the file's own `:root` and dark values, so it cannot drift from 0.83.0. */
function tokenSet(id: PaletteId, base: Record<Theme, Tokens>): TokenSet {
  if (id !== "poel") return generated(id, base);
  const pick = (theme: Theme): Tokens =>
    Object.fromEntries(NAMES.map((name) => [name, at(base[theme], name)]));
  return { light: pick("light"), dark: pick("dark"), picks: [] };
}

function block(id: PaletteId, theme: Theme, tokens: Tokens): string {
  const selector =
    theme === "light" ? `[data-palette="${id}"]` : `[data-palette="${id}"][data-theme="dark"]`;
  const lines = NAMES.map((name) => `  ${name}: ${at(tokens, name)};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}

/** The eight palette blocks, for the region between the markers in kasten-theme.css. */
export function css(): string {
  const base = themeBlocks(readFileSync(THEME_CSS, "utf8"));
  return PALETTES.flatMap((id) => {
    const set = tokenSet(id, base);
    return THEMES.map((theme) => block(id, theme, set[theme]));
  }).join("\n\n");
}

/**
 * The least lightness gap, in OKLab L, between a palette's danger and its accent, for
 * a danger that is not WARN_APART degrees of hue away. Hue and lightness are the two
 * axes left to tell them apart, and a red accent leaves no hue room, so danger steps darker.
 */
const DANGER_LIGHT_APART = 0.08;

export interface Measures {
  accentOnPaper: number;
  accentOnSurface: number;
  linkOnPaper: number;
  accentOnWash: number;
  inkOnHighlight: number;
  linkOnHighlight: number;
  mutedOnHighlight: number;
  lowestStatus: number;
  lowestTag: number;
  highestChroma: number;
  warnGap: number;
  dangerGap: number;
  dangerLightGap: number;
  dangerWarnGap: number;
  dangerHue: number;
}

/** The light hue of a token, as the file paints it: an alpha colour is read as its top colour. */
function hueOf(tokens: Tokens, name: string): number {
  return rgbToLch(colour(at(tokens, name), BLACK)).h;
}

/** The pairs of the contrast table, measured over the tokens of one palette and theme. */
function measure(tokens: Tokens): Measures {
  const paper = colour(at(tokens, "--k-paper"), BLACK);
  const bg = colour(at(tokens, "--k-bg"), BLACK);
  const surface = colour(at(tokens, "--k-surface"), BLACK);
  const wash = colour(at(tokens, "--k-accent-wash"), paper);
  const highlight = colour(at(tokens, "--k-highlight"), paper);
  const onGround = (name: string, ground: RGB) => ratio(colour(at(tokens, name), ground), ground);
  const lightOf = (name: string) => rgbToLch(colour(at(tokens, name), BLACK)).l;
  return {
    accentOnPaper: onGround("--k-accent", paper),
    accentOnSurface: onGround("--k-accent", surface),
    linkOnPaper: onGround("--k-link", paper),
    accentOnWash: onGround("--k-accent", wash),
    inkOnHighlight: onGround("--k-ink", highlight),
    linkOnHighlight: onGround("--k-link", highlight),
    mutedOnHighlight: onGround("--k-muted", highlight),
    lowestStatus: Math.min(...STATUS.map((n) => onGround(n, paper))),
    lowestTag: Math.min(...TAGS.map((n) => onGround(n, bg))),
    highestChroma: Math.max(
      ...[...STATUS, ...TAGS].map((n) => rgbToLch(colour(at(tokens, n), BLACK)).c),
    ),
    warnGap: hueGap(hueOf(tokens, "--k-warn"), hueOf(tokens, "--k-accent")),
    dangerGap: hueGap(hueOf(tokens, "--k-danger"), hueOf(tokens, "--k-accent")),
    dangerLightGap: Math.abs(lightOf("--k-danger") - lightOf("--k-accent")),
    dangerWarnGap: hueGap(hueOf(tokens, "--k-danger"), hueOf(tokens, "--k-warn")),
    dangerHue: hueOf(tokens, "--k-danger"),
  };
}

/** What the file paints, measured per palette and theme. A missing block measures as poel. */
export function checks(): Record<PaletteId, Record<Theme, Measures>> {
  const css = readFileSync(THEME_CSS, "utf8");
  const base = themeBlocks(css);
  return Object.fromEntries(
    PALETTES.map((id) => [
      id,
      Object.fromEntries(
        THEMES.map((theme) => [
          theme,
          measure({ ...base[theme], ...paletteBlock(css, id, theme) }),
        ]),
      ),
    ]),
  ) as Record<PaletteId, Record<Theme, Measures>>;
}

/**
 * Each status and tag pair of a palette and theme under MIN_APART in painted hue, with
 * the gap to a tenth of a degree. A tag near a status colour is the wrong signal.
 */
export function statusTagClose(): Record<PaletteId, Record<Theme, [string, string, number][]>> {
  const css = readFileSync(THEME_CSS, "utf8");
  const base = themeBlocks(css);
  return Object.fromEntries(
    PALETTES.map((id) => [
      id,
      Object.fromEntries(
        THEMES.map((theme) => {
          const tokens = { ...base[theme], ...paletteBlock(css, id, theme) };
          const out: [string, string, number][] = [];
          for (const status of STATUS) {
            for (const tag of TAGS) {
              const gap = hueGap(hueOf(tokens, status), hueOf(tokens, tag));
              if (gap < MIN_APART) out.push([status, tag, Math.round(gap * 10) / 10]);
            }
          }
          return [theme, out];
        }),
      ),
    ]),
  ) as Record<PaletteId, Record<Theme, [string, string, number][]>>;
}

/** The bar a measure must reach, or undefined where the measure is graded some other way. */
function bar(theme: Theme, key: keyof Measures): number | undefined {
  if (
    key === "highestChroma" ||
    key === "warnGap" ||
    key === "dangerGap" ||
    key === "dangerLightGap" ||
    key === "dangerWarnGap" ||
    key === "dangerHue"
  )
    return undefined;
  if (theme === "light" && key === "accentOnPaper") return 5;
  if (theme === "light" && key === "accentOnSurface") return 4.6;
  if (theme === "dark" && key === "accentOnPaper") return 6;
  return 4.5;
}

const ROWS: [keyof Measures, string][] = [
  ["accentOnPaper", "Accent on paper"],
  ["accentOnSurface", "Accent on surface"],
  ["linkOnPaper", "Link on paper"],
  ["accentOnWash", "Accent on its wash"],
  ["inkOnHighlight", "Ink on highlight"],
  ["linkOnHighlight", "Link on highlight"],
  ["mutedOnHighlight", "Muted on highlight"],
  ["lowestStatus", "Lowest status on paper"],
  ["lowestTag", "Lowest tag on bg"],
  ["highestChroma", "Highest chroma of status and tags"],
  ["warnGap", "Warn hue gap to accent"],
  ["dangerGap", "Danger hue gap to accent"],
  ["dangerLightGap", "Danger lightness gap to accent"],
];

/** One cell of the measures table. The lightness gap is only flagged when the hue gap misses too. */
function cell(id: PaletteId, theme: Theme, key: keyof Measures, m: Measures): string {
  const value = m[key];
  if (key === "warnGap") {
    const shown = value.toFixed(1);
    return value < WARN_APART ? `${shown} (under ${WARN_APART})` : shown;
  }
  if (key === "dangerGap") return value.toFixed(1);
  if (key === "dangerLightGap") {
    const shown = value.toFixed(3);
    const flag = value < DANGER_LIGHT_APART && m.dangerGap < WARN_APART;
    return flag ? `${shown} (under ${DANGER_LIGHT_APART})` : shown;
  }
  if (key === "highestChroma") {
    const shown = value.toFixed(3);
    return id !== "poel" && value > CAP[theme] ? `${shown} (over ${CAP[theme]})` : shown;
  }
  const shown = value.toFixed(2);
  const floor = bar(theme, key);
  return floor !== undefined && value < floor ? `${shown} (under ${floor})` : shown;
}

/** The markdown tables of the docs region: the measures, then the picks. */
export function table(): string {
  const measured = checks();
  const base = themeBlocks(readFileSync(THEME_CSS, "utf8"));
  const columns = PALETTES.flatMap((id) => THEMES.map((theme) => ({ id, theme })));
  const head = `| Measure | ${columns.map((c) => `${c.id} ${c.theme}`).join(" | ")} |`;
  const rule = `|---|${columns.map(() => "---:").join("|")}|`;
  const measures = ROWS.map(
    ([key, label]) =>
      `| ${label} | ${columns
        .map((c) => cell(c.id, c.theme, key, measured[c.id][c.theme]))
        .join(" | ")} |`,
  );
  // Hues are in degrees, so a reader can see each pick keep the hue of its slot.
  const hue = (hex: string) => Math.round(rgbToLch(hexRgb(hex)).h);
  const picks = (["russet", "peach", "pansy"] as const).flatMap((id) => {
    const set = tokenSet(id, base);
    return set.picks.map((p) => {
      const light = at(set.light, p.slot);
      const dark = at(set.dark, p.slot);
      const slot = p.fallback ? `${p.slot} (fallback)` : p.slot;
      return `| ${id} | ${slot} | ${hue(at(base.light, p.slot))} | ${p.name} | ${hue(p.seed)} | ${light} | ${hue(light)} | ${dark} | ${hue(dark)} |`;
    });
  });
  const close = closePairs();
  const closeRows = (Object.keys(close) as GeneratedId[]).flatMap((id) =>
    close[id].map((c) => `| ${id} | ${c.pair[0]} and ${c.pair[1]} | ${c.gap.toFixed(1)} |`),
  );
  return [
    head,
    rule,
    ...measures,
    "",
    "| Palette | Slot | Poel hue | Wada colour | Wada hue | Light | Light hue | Dark | Dark hue |",
    "|---|---|---:|---|---:|---|---:|---|---:|",
    ...picks,
    "",
    "| Palette | Pair under 20 degrees | Gap |",
    "|---|---|---:|",
    ...closeRows,
  ].join("\n");
}

if (import.meta.main) {
  console.log(css());
  console.log(table());
}
