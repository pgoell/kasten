import { useSyncExternalStore } from "react";
import { COARSE, useViewport } from "@/lib/use-viewport";

const VIM_KEY = "kasten.vim";

/**
 * Every mounted editor, told when the setting moves.
 *
 * The browser's own `storage` event reaches every tab but the one that wrote,
 * and the panes that have to follow a toggle are all in the tab that wrote.
 */
const listeners = new Set<() => void>();

function subscribe(changed: () => void) {
  listeners.add(changed);
  return () => listeners.delete(changed);
}

function stored(): string | null {
  return localStorage.getItem(VIM_KEY);
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
  const on = enabled(stored(), window.matchMedia(COARSE).matches);
  localStorage.setItem(VIM_KEY, on ? "off" : "on");
  for (const changed of listeners) changed();
}
