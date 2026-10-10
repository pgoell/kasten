import { useSyncExternalStore } from "react";
import { COARSE, useViewport } from "@/lib/use-viewport";

const VIM_KEY = "kasten.vim";

/**
 * Every mounted editor, told when the setting moves.
 *
 * The browser's own `storage` event reaches every tab but the one that wrote,
 * so the tab that wrote tells its own panes through this set.
 */
const listeners = new Set<() => void>();

/**
 * The other tabs are listened to as well, so a toggle in one flips them all at
 * the moment it is made, which is a moment nobody is typing in them. Reading
 * the store on the next render alone would flip a tab under the reader's
 * hands, and the keys that followed would run as normal-mode commands.
 */
function subscribe(changed: () => void) {
  listeners.add(changed);
  window.addEventListener("storage", changed);
  return () => {
    listeners.delete(changed);
    window.removeEventListener("storage", changed);
  };
}

/** A choice the browser refused to store, which holds until the page goes. */
let unstored: string | null = null;

/**
 * A browser with site data blocked throws a `SecurityError` on any touch of
 * `localStorage`. This is read on every render of every editor, so that reads
 * as no choice made rather than as an app that will not draw.
 */
function stored(): string | null {
  if (unstored !== null) return unstored;
  try {
    return localStorage.getItem(VIM_KEY);
  } catch (error) {
    if (error instanceof DOMException) return null;
    throw error;
  }
}

/**
 * A choice made by hand wins. With none made, a finger gets a plain editor:
 * an on-screen keyboard has no Escape, and normal mode swallows the first tap
 * of every edit.
 */
function enabled(choice: string | null, coarse: boolean): boolean {
  return choice === null ? !coarse : choice === "on";
}

/** Whether the editor runs vim, for every pane at once. */
export function useVim(): boolean {
  const { coarse } = useViewport();
  return enabled(useSyncExternalStore(subscribe, stored), coarse);
}

/** Turn vim on or off by hand, and keep the answer across a reload. */
export function toggleVim(): void {
  const next = enabled(stored(), window.matchMedia(COARSE).matches) ? "off" : "on";
  try {
    localStorage.setItem(VIM_KEY, next);
    unstored = null;
  } catch (error) {
    // Blocked, or full. The toggle still has to do what it was asked for.
    if (!(error instanceof DOMException)) throw error;
    unstored = next;
  }
  for (const changed of listeners) changed();
}
