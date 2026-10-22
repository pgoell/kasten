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
import { WADA, type WadaColour } from "./wada";

const THEME_CSS = path.join(import.meta.dirname, "..", "src", "styles", "kasten-theme.css");

export const PALETTES = ["poel", "russet", "peach", "pansy"] as const;
export type PaletteId = (typeof PALETTES)[number];
type GeneratedId = Exclude<PaletteId, "poel">;
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

type RGB = [number, number, number];
type Tokens = Record<string, string>;
interface LCH {
  l: number;
  c: number;
  h: number;
}

const TAGS = Array.from({ length: 10 }, (_, i) => `--tg-${i + 1}`);
const STATUS = ["--k-ok", "--k-warn", "--k-info", "--k-danger"];

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

/** The slots picked in order: danger first, so it gets the Wada colour nearest its hue. */
const SLOTS = ["--k-danger", "--k-warn", "--k-ok", "--k-info", ...TAGS];

/** Bars for the status and tag colours: light on the ground it is read on, dark at 8. */
const TARGET: Record<Theme, { status: number; tag: number }> = {
  light: { status: 5, tag: 4.5 },
  dark: { status: 8, tag: 8 },
};

/** The chroma cap, so no tag is louder than the accent. */
const CAP: Record<Theme, number> = { light: 0.12, dark: 0.1 };

/** The issue's table. Accent and highlight are inputs, never changed to pass a bar. */
interface Generated {
  anchor: string;
  numbers: readonly number[];
  accent: Record<Theme, string>;
  highlight: Record<Theme, { hex: string; percent: number }>;
}

const GENERATED: Record<GeneratedId, Generated> = {
  russet: {
    anchor: "Hay's Russet",
    numbers: [345],
    accent: { light: "#9a5143", dark: "#e59c8d" },
    highlight: {
      light: { hex: "#62c6bf", percent: 30 },
      dark: { hex: "#62c6bf", percent: 24 },
    },
  },
  peach: {
    anchor: "Peach Red",
    numbers: [303, 310],
    accent: { light: "#b93100", dark: "#fd8e70" },
    highlight: {
      light: { hex: "#eeb480", percent: 30 },
      dark: { hex: "#eeb480", percent: 24 },
    },
  },
  pansy: {
    anchor: "Pansy Purple",
    numbers: [273],
    accent: { light: "#a83f5d", dark: "#f48da5" },
    highlight: {
      light: { hex: "#f9c1ce", percent: 30 },
      dark: { hex: "#f9c1ce", percent: 24 },
    },
  },
};

const BLACK: RGB = [0, 0, 0];

// Colour maths, from the CSS and Ottosson's OKLab matrices. Hex in, hex out.

function at(tokens: Tokens, name: string): string {
  return tokens[name] ?? "";
}

function hexRgb(hex: string): RGB {
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(1 + i, 3 + i), 16)) as RGB;
}

/** A colour as WCAG sees it: an alpha colour is blended over the backdrop it sits on. */
function colour(value: string, backdrop: RGB): RGB {
  if (/^#[0-9a-f]{6}$/i.test(value)) return hexRgb(value);
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(value);
  if (!m) throw new Error(`unreadable colour ${value}`);
  const alpha = Number(m[4]);
  const top = [m[1], m[2], m[3]].map(Number);
  return top.map((c, i) => alpha * c + (1 - alpha) * (backdrop[i] ?? 0)) as RGB;
}

function linear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: RGB): number {
  const [r, g, b] = [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function rgbToLch(rgb: RGB): LCH {
  const [r, g, b] = [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** Linear sRGB of a lightness, chroma and hue. Outside the gamut, the channels fall outside 0 to 1. */
function lchToLinear({ l, c, h }: LCH): RGB {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
  ];
}

const inGamut = (lch: LCH): boolean => lchToLinear(lch).every((x) => x >= -1e-6 && x <= 1 + 1e-6);

function encode(x: number): number {
  const v = Math.min(1, Math.max(0, x));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

function lchHex(lch: LCH): string {
  const channels = lchToLinear(lch).map((x) => Math.round(encode(x) * 255));
  return `#${channels.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** The colour at a lightness and hue, with its chroma lowered until it is inside sRGB. */
function gamutHex(lch: LCH): string {
  if (inGamut(lch)) return lchHex(lch);
  let lo = 0;
  let hi = lch.c;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ ...lch, c: mid })) lo = mid;
    else hi = mid;
  }
  return lchHex({ ...lch, c: lo });
}

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function alphaOf(percent: number): string {
  return (percent / 100).toFixed(2).slice(1);
}

function withAlpha(hex: string, alpha: string): string {
  return `rgba(${hexRgb(hex).join(",")},${alpha})`;
}

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

interface Candidate {
  wada: WadaColour;
  lch: LCH;
}

/**
 * The Wada colours near a palette: those in a combination with its numbers, and
 * those in a combination with any of those. Greys, the anchor colour and anything
 * as close in hue as the accent are left out, so no status or tag reads as the accent.
 */
function poolFor(spec: Generated, accentHue: number): Candidate[] {
  const numbers = new Set<number>(spec.numbers);
  const direct = WADA.filter((w) => w.combinations.some((n) => numbers.has(n)));
  const reach = new Set(direct.flatMap((w) => w.combinations));
  return WADA.filter((w) => w.name !== spec.anchor && w.combinations.some((n) => reach.has(n)))
    .map((wada) => ({ wada, lch: rgbToLch(hexRgb(wada.hex)) }))
    .filter((p) => p.lch.c >= 0.04 && hueGap(p.lch.h, accentHue) > 20);
}

/** The seed's lightness and chroma for one theme, nudged until the rounded hex passes. */
function fitSeed(seed: string, ground: RGB, target: number, theme: Theme): string {
  const seedLch = rgbToLch(hexRgb(seed));
  const cap = CAP[theme];
  const chroma = Math.min(seedLch.c, cap);
  const hexAt = (l: number, c: number) => gamutHex({ l, c, h: seedLch.h });
  const reaches = (l: number) => ratio(hexRgb(hexAt(l, chroma)), ground) >= target;
  // Contrast falls as lightness rises on a light ground and rises on a dark one.
  // So the edge of the target is the largest lightness that reaches it on light,
  // and the smallest on dark.
  const start = reaches(0);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (reaches(mid) === start) lo = mid;
    else hi = mid;
  }
  let l = start ? lo : hi;
  // One step at a time, away from the ground, so a rounding miss never lands
  // the colour on the wrong side of the bar.
  const away = theme === "light" ? -0.001 : 0.001;
  let c = chroma;
  for (let i = 0; i < 1000; i++) {
    const hex = hexAt(l, c);
    const over = rgbToLch(hexRgb(hex)).c > cap;
    const miss = ratio(hexRgb(hex), ground) < target;
    if (!over && !miss) return hex;
    if (over) c -= 0.001;
    if (miss) l += away;
  }
  throw new Error(`no fit for ${seed} on ${theme}`);
}

interface Pick {
  slot: string;
  name: string;
  seed: string;
  /** The light hue of the fitted colour, which is what the file paints. */
  hue: number;
  /** True when no colour left in the pool sat this far from the earlier picks. */
  fallback: boolean;
}

/** The least hue gap between any two colours of one palette's statuses and tags. */
const MIN_APART = 20;

interface TokenSet {
  light: Tokens;
  dark: Tokens;
  picks: Pick[];
}

function tokensFor(spec: Generated, picks: Pick[], base: Record<Theme, Tokens>, theme: Theme) {
  const accent = spec.accent[theme];
  const highlight = spec.highlight[theme];
  const paper = colour(at(base[theme], "--k-paper"), BLACK);
  const bg = colour(at(base[theme], "--k-bg"), BLACK);
  const tokens: Tokens = {
    "--k-accent": accent,
    "--k-link": accent,
    "--k-accent-wash": withAlpha(accent, theme === "light" ? ".11" : ".14"),
    "--k-highlight": withAlpha(highlight.hex, alphaOf(highlight.percent)),
    "--k-mark": withAlpha(highlight.hex, alphaOf(highlight.percent)),
  };
  for (const pick of picks) {
    const tag = pick.slot.startsWith("--tg-");
    const ground = tag ? bg : paper;
    tokens[pick.slot] = fitSeed(pick.seed, ground, TARGET[theme][tag ? "tag" : "status"], theme);
  }
  return tokens;
}

/**
 * Picks one Wada colour per slot. A pick sits at least MIN_APART from every
 * earlier pick of the palette, and among those is nearest in hue to poel's value
 * of the slot. Only when none is left at MIN_APART does the farthest one go in.
 */
function generated(id: GeneratedId, base: Record<Theme, Tokens>): TokenSet {
  const spec = GENERATED[id];
  const pool = poolFor(spec, rgbToLch(hexRgb(spec.accent.light)).h);
  const taken = new Set<string>();
  const picks: Pick[] = [];
  for (const slot of SLOTS) {
    const target = rgbToLch(hexRgb(at(base.light, slot))).h;
    const tag = slot.startsWith("--tg-");
    const ground = colour(at(base.light, tag ? "--k-bg" : "--k-paper"), BLACK);
    const bar = TARGET.light[tag ? "tag" : "status"];
    const free = pool
      .filter((p) => !taken.has(p.wada.name))
      .map((p) => ({
        ...p,
        hue: rgbToLch(hexRgb(fitSeed(p.wada.hex, ground, bar, "light"))).h,
      }));
    const apart = (hue: number) => Math.min(360, ...picks.map((q) => hueGap(hue, q.hue)));
    const nearest = (a: (typeof free)[number], b: (typeof free)[number]) =>
      hueGap(a.lch.h, target) - hueGap(b.lch.h, target) ||
      b.lch.c - a.lch.c ||
      (a.wada.name < b.wada.name ? -1 : 1);
    const spaced = free.filter((p) => apart(p.hue) >= MIN_APART).sort(nearest);
    const fallback = spaced.length === 0;
    const ranked = fallback
      ? free.sort((a, b) => apart(b.hue) - apart(a.hue) || nearest(a, b))
      : spaced;
    const best = ranked[0];
    if (!best) throw new Error(`no Wada colour left for ${slot} in ${id}`);
    taken.add(best.wada.name);
    picks.push({ slot, name: best.wada.name, seed: best.wada.hex, hue: best.hue, fallback });
  }
  return {
    light: tokensFor(spec, picks, base, "light"),
    dark: tokensFor(spec, picks, base, "dark"),
    picks,
  };
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
}

/** The pairs of the contrast table, measured over the tokens of one palette and theme. */
function measure(tokens: Tokens): Measures {
  const paper = colour(at(tokens, "--k-paper"), BLACK);
  const bg = colour(at(tokens, "--k-bg"), BLACK);
  const surface = colour(at(tokens, "--k-surface"), BLACK);
  const wash = colour(at(tokens, "--k-accent-wash"), paper);
  const highlight = colour(at(tokens, "--k-highlight"), paper);
  const onGround = (name: string, ground: RGB) => ratio(colour(at(tokens, name), ground), ground);
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

/** The bar a measure must reach, or undefined where the measure is graded some other way. */
function bar(theme: Theme, key: keyof Measures): number | undefined {
  if (key === "highestChroma") return undefined;
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
];

function cell(id: PaletteId, theme: Theme, key: keyof Measures, value: number): string {
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
        .map((c) => cell(c.id, c.theme, key, measured[c.id][c.theme][key]))
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
  return [
    head,
    rule,
    ...measures,
    "",
    "| Palette | Slot | Poel hue | Wada colour | Wada hue | Light | Light hue | Dark | Dark hue |",
    "|---|---|---:|---|---:|---|---:|---|---:|",
    ...picks,
  ].join("\n");
}

if (import.meta.main) {
  console.log(css());
  console.log(table());
}
