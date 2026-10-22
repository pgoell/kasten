/** The light and dark theme, set on `<html>` as `data-theme`. */

export const THEME_KEY = "kasten.theme";
export type Theme = "light" | "dark";

const DARK = "(prefers-color-scheme: dark)";
const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * Every part of the page that paints in the theme, told when it moves.
 *
 * The tab that wrote is told here, and the other tabs by the `storage` event,
 * which the browser sends to every tab but the one that wrote.
 */
const listeners = new Set<() => void>();

/** A choice the browser refused to store, which holds until the page goes. */
let unstored: string | null = null;

/**
 * A browser with site data blocked throws a `SecurityError` on any touch of
 * `localStorage`. That reads as no choice made, so the system decides.
 */
function stored(): string | null {
  if (unstored !== null) return unstored;
  try {
    return localStorage.getItem(THEME_KEY);
  } catch (error) {
    if (error instanceof DOMException) return null;
    throw error;
  }
}

/** The choice made by hand, or null when none was (a stray value counts as none). */
function chosen(): Theme | null {
  const value = stored();
  return value === "light" || value === "dark" ? value : null;
}

/** The theme on screen: a choice made by hand wins, else the system's. */
export function currentTheme(): Theme {
  return chosen() ?? (matchMedia(DARK).matches ? "dark" : "light");
}

/**
 * Sets `data-theme`, then the browser bar's colour to the page colour, so the
 * bar matches whichever theme is showing.
 */
export function applyTheme(): void {
  const root = document.documentElement;
  root.dataset.theme = currentTheme();
  const page = getComputedStyle(root).getPropertyValue("--k-bg").trim();
  const bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (bar && page) bar.content = page;
  for (const changed of listeners) changed();
}

/**
 * Flips the theme and keeps the answer across a reload. The switch cross-fades
 * where the browser can, and is instant for a reader who asked for no motion.
 */
export function toggleTheme(): void {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, next);
    unstored = null;
  } catch (error) {
    // Blocked, or full. The toggle still has to do what it was asked for.
    if (!(error instanceof DOMException)) throw error;
    unstored = next;
  }
  if (document.startViewTransition && !matchMedia(REDUCED).matches) {
    document.startViewTransition(applyTheme);
  } else {
    applyTheme();
  }
}

/** Calls `listener` on every switch, from this tab or another. */
export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Applies the theme once, then follows the system while no choice is stored,
 * and any switch made in another tab.
 */
export function startTheme(): void {
  applyTheme();
  matchMedia(DARK).addEventListener("change", () => {
    if (chosen() === null) applyTheme();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY) applyTheme();
  });
}
