/**
 * The light and dark theme on `<html>` as `data-theme`, and the accent palette as `data-palette`.
 */

export const THEME_KEY = "kasten.theme";
export type Theme = "light" | "dark";

export const PALETTE_KEY = "kasten.palette";
export const PALETTES = ["poel", "russet", "peach", "pansy"] as const;
export type Palette = (typeof PALETTES)[number];

const DARK = "(prefers-color-scheme: dark)";
const REDUCED = "(prefers-reduced-motion: reduce)";

/** Told on each switch. This tab is told here; others by the `storage` event. */
const listeners = new Set<() => void>();

/** Choices the browser refused to store, by key, which hold until the page goes. */
const unstored = new Map<string, string>();

/** Blocked storage throws on any touch; that reads as no choice made, so the system decides. */
function stored(key: string): string | null {
  const held = unstored.get(key);
  if (held !== undefined) return held;
  try {
    return localStorage.getItem(key);
  } catch (error) {
    if (error instanceof DOMException) return null;
    throw error;
  }
}

/** Keeps a choice, or holds it for the page when the browser refuses to store it. */
function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    unstored.delete(key);
  } catch (error) {
    // Blocked, or full. The choice still has to do what it was asked for.
    if (!(error instanceof DOMException)) throw error;
    unstored.set(key, value);
  }
}

/** Cross-fades the update where the browser can; at once for a reader who asked for no motion. */
function show(update: () => void): void {
  if (document.startViewTransition && !matchMedia(REDUCED).matches) {
    document.startViewTransition(update);
  } else {
    update();
  }
}

/** The choice made by hand, or null when none was (a stray value counts as none). */
function chosen(): Theme | null {
  const value = stored(THEME_KEY);
  return value === "light" || value === "dark" ? value : null;
}

/** The theme on screen: a choice made by hand wins, else the system's. */
export function currentTheme(): Theme {
  return chosen() ?? (matchMedia(DARK).matches ? "dark" : "light");
}

/** The palette on screen: the one picked, or poel. A stray stored id counts as none. */
export function currentPalette(): Palette {
  const value = stored(PALETTE_KEY);
  return PALETTES.find((id) => id === value) ?? "poel";
}

/** Sets the theme and palette, then the browser bar's colour to the page colour. */
export function applyTheme(): void {
  const root = document.documentElement;
  root.dataset.theme = currentTheme();
  root.dataset.palette = currentPalette();
  const page = getComputedStyle(root).getPropertyValue("--k-bg").trim();
  const bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (bar && page) bar.content = page;
  for (const changed of listeners) changed();
}

/** Flips the theme, keeps the choice across a reload, and cross-fades where the browser can. */
export function toggleTheme(): void {
  keep(THEME_KEY, currentTheme() === "dark" ? "light" : "dark");
  show(applyTheme);
}

/** Picks an accent palette and keeps it across a reload, cross-fading as the toggle does. */
export function pickPalette(id: Palette): void {
  keep(PALETTE_KEY, id);
  show(applyTheme);
}

/** Calls `listener` on every switch, from this tab or another. */
export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Applies the theme, then follows the system while no choice is stored, and other tabs. */
export function startTheme(): void {
  applyTheme();
  matchMedia(DARK).addEventListener("change", () => {
    if (chosen() === null) applyTheme();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY || event.key === PALETTE_KEY) applyTheme();
  });
}
