import { useSyncExternalStore } from "react";

/** One file going into the vault from a note, as the status bar reads it. */
export interface Upload {
  name: string;
  sent: number;
  total: number;
}

/**
 * Module level, not a view's: an upload outlives the note it was pasted into, and the bar
 * belongs to no view (#1945).
 */
let uploads: readonly Upload[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly Upload[]) {
  uploads = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every upload in the air, oldest first. */
export function useUploads(): readonly Upload[] {
  return useSyncExternalStore(subscribe, () => uploads);
}

/**
 * Runs `send` with its upload on the bar from the start, moved by the progress `send` reports,
 * and off the bar once it settles either way.
 */
export async function tracked<T>(
  name: string,
  total: number,
  send: (progress: (sent: number, total: number) => void) => Promise<T>,
): Promise<T> {
  const own: Upload = { name, sent: 0, total };
  let current = own;
  publish([...uploads, own]);
  const progress = (sent: number, of: number) => {
    const next = { name, sent, total: of };
    publish(uploads.map((upload) => (upload === current ? next : upload)));
    current = next;
  };
  try {
    return await send(progress);
  } finally {
    publish(uploads.filter((upload) => upload !== current));
  }
}
