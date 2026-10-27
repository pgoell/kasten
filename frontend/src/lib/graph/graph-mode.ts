/**
 * How the vault graph groups its notes: by folder, or by tag. Kept per device,
 * so a graph opened on a phone is grouped the way it was left on the phone.
 */

export const GRAPH_MODE_KEY = "kasten.graph.mode";
export type GraphMode = "folders" | "tags";

/** A choice the browser refused to store, which holds until the page goes. */
let refused: GraphMode | null = null;

/**
 * A browser with site data blocked throws a `SecurityError` on any touch of
 * `localStorage`. That reads as no choice made, so the mode is Folders.
 */
export function readGraphMode(): GraphMode {
  if (refused !== null) return refused;
  let value: string | null;
  try {
    value = localStorage.getItem(GRAPH_MODE_KEY);
  } catch (error) {
    if (error instanceof DOMException) return "folders";
    throw error;
  }
  return value === "tags" ? "tags" : "folders";
}

/** Keeps a choice, or holds it for the page when the browser refuses to store it. */
export function writeGraphMode(mode: GraphMode): void {
  try {
    localStorage.setItem(GRAPH_MODE_KEY, mode);
    refused = null;
  } catch (error) {
    // Blocked, or full. The switch still has to do what it was asked for.
    if (!(error instanceof DOMException)) throw error;
    refused = mode;
  }
}
