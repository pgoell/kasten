/**
 * The colour maths of the accent palettes: hex and sRGB, WCAG 2 contrast, and
 * OKLab and OKLCh with gamut mapping. Hex in, hex out, so the generator never
 * handles a colour in any other form.
 *
 * The matrices are Björn Ottosson's. The luminance threshold is WCAG's, so a
 * ratio here is the one `tests/theme-contrast.test.ts` measures.
 */

export type RGB = [number, number, number];

export const BLACK: RGB = [0, 0, 0];

export interface LCH {
  l: number;
  c: number;
  h: number;
}

export function hexRgb(hex: string): RGB {
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(1 + i, 3 + i), 16)) as RGB;
}

/** A colour as WCAG sees it: an alpha colour is blended over the backdrop it sits on. */
export function colour(value: string, backdrop: RGB): RGB {
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

export function ratio(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

export function rgbToLch(rgb: RGB): LCH {
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
export function gamutHex(lch: LCH): string {
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

export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}
