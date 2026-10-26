/**
 * The picking side of the accent palettes: which Wada colour fills each status and
 * tag slot of russet, peach and pansy, and how each one is fitted to its ground.
 *
 * `generated` builds a palette from the Wada colours and the file's own poel values.
 * palettes.ts reads the file, measures the result and writes the CSS and the tables.
 */
import {
  BLACK,
  colour,
  gamutHex,
  hexRgb,
  hueGap,
  type LCH,
  type RGB,
  ratio,
  rgbToLch,
} from "./colour";
import { WADA, type WadaColour } from "./wada";

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export type Tokens = Record<string, string>;

/** The token value of one name, or "" when the block does not set it. */
export function at(tokens: Tokens, name: string): string {
  return tokens[name] ?? "";
}

function alphaOf(percent: number): string {
  return (percent / 100).toFixed(2).slice(1);
}

function withAlpha(hex: string, alpha: string): string {
  return `rgba(${hexRgb(hex).join(",")},${alpha})`;
}

export const TAGS = Array.from({ length: 10 }, (_, i) => `--tg-${i + 1}`);
export const STATUS = ["--k-ok", "--k-warn", "--k-info", "--k-danger"];

/** The slots picked in order: danger first, so it gets the Wada colour nearest its hue. */
export const SLOTS = ["--k-danger", "--k-warn", "--k-ok", "--k-info", ...TAGS];

/**
 * Bars for the status and tag colours: light on the ground it is read on, dark at 8.
 * Danger has its own bar, darker than the accent on both themes (see DANGER_LIGHT_APART).
 */
const TARGET: Record<Theme, { status: number; tag: number; danger: number }> = {
  light: { status: 5, tag: 4.5, danger: 9 },
  dark: { status: 8, tag: 8, danger: 5.5 },
};

/** The bar a slot's colour must reach on its ground in one theme. */
function barFor(slot: string, theme: Theme): number {
  if (slot === "--k-danger") return TARGET[theme].danger;
  return TARGET[theme][slot.startsWith("--tg-") ? "tag" : "status"];
}

/** The chroma cap, so no tag is louder than the accent. */
export const CAP: Record<Theme, number> = { light: 0.12, dark: 0.1 };

/**
 * The least hue gap, in degrees, between a palette's warn and its accent. Lightness is
 * fixed by the contrast fit and chroma is capped, so hue is the only axis left to
 * tell them apart. 60 is one sixth of the wheel, the step from red to yellow. The
 * pick of --k-warn only takes colours this far from the accent.
 */
export const WARN_APART = 60;

/** The least hue gap between any two colours of one palette's statuses and tags. */
export const MIN_APART = 20;

export type GeneratedId = "russet" | "peach" | "pansy";

/** The issue's table. Accent and highlight are inputs, never changed to pass a bar. */
interface Generated {
  anchor: string;
  numbers: readonly number[];
  accent: Record<Theme, string>;
  highlight: Record<Theme, { hex: string; percent: number }>;
}

export const GENERATED: Record<GeneratedId, Generated> = {
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

export interface TokenSet {
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
    tokens[pick.slot] = fitSeed(pick.seed, ground, barFor(pick.slot, theme), theme);
  }
  return tokens;
}

/**
 * Picks one Wada colour per slot. A pick sits at least MIN_APART from every
 * earlier pick of the palette, and among those is nearest in hue to poel's value
 * of the slot. Only when none is left at MIN_APART does the fallback run: it takes
 * a colour clear of every status first, then the farthest from the earlier picks.
 * The warn is first limited to colours at least WARN_APART from the accent, so
 * the two stay apart even where the pool would put a near colour in their place.
 */
export function generated(id: GeneratedId, base: Record<Theme, Tokens>): TokenSet {
  const spec = GENERATED[id];
  const accentHue = rgbToLch(hexRgb(spec.accent.light)).h;
  const pool = poolFor(spec, accentHue);
  const taken = new Set<string>();
  const picks: Pick[] = [];
  for (const slot of SLOTS) {
    const target = rgbToLch(hexRgb(at(base.light, slot))).h;
    const tag = slot.startsWith("--tg-");
    const ground = colour(at(base.light, tag ? "--k-bg" : "--k-paper"), BLACK);
    const bar = barFor(slot, "light");
    const free = pool
      .filter((p) => !taken.has(p.wada.name))
      .map((p) => ({
        ...p,
        hue: rgbToLch(hexRgb(fitSeed(p.wada.hex, ground, bar, "light"))).h,
      }))
      .filter((p) => slot !== "--k-warn" || hueGap(p.hue, accentHue) >= WARN_APART);
    const apart = (hue: number) => Math.min(360, ...picks.map((q) => hueGap(hue, q.hue)));
    const nearest = (a: (typeof free)[number], b: (typeof free)[number]) =>
      hueGap(a.lch.h, target) - hueGap(b.lch.h, target) ||
      b.lch.c - a.lch.c ||
      (a.wada.name < b.wada.name ? -1 : 1);
    const spaced = free.filter((p) => apart(p.hue) >= MIN_APART).sort(nearest);
    const fallback = spaced.length === 0;
    const statusApart = (hue: number) =>
      Math.min(360, ...picks.filter((q) => STATUS.includes(q.slot)).map((q) => hueGap(hue, q.hue)));
    const clear = (p: (typeof free)[number]) => (statusApart(p.hue) >= MIN_APART ? 1 : 0);
    // A tag near a tag is cosmetic; a tag near a status colour reads as a wrong signal,
    // so the fallback keeps clear of every status first and only then looks for distance.
    const ranked = fallback
      ? free.sort((a, b) => clear(b) - clear(a) || apart(b.hue) - apart(a.hue) || nearest(a, b))
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
