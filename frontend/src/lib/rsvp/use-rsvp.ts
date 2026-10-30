import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Pane } from "@/lib/panes";

/** A press of `<leader>rr` or `<leader>rh`, counted, so a second press asks again. */
export interface RsvpAsk {
  /** Start from the selection, the cursor or the page on screen, rather than resume. */
  here: boolean;
  signal: number;
}

/**
 * The last press and the pane it was made in. Kept here rather than in route state, since the panes
 * read it through `useRsvpAsked`.
 */
let asked: { pane: string } & RsvpAsk = { pane: "", here: false, signal: 0 };
const listeners = new Set<() => void>();

/**
 * Ask `pane` to read itself word by word. A note, a page, a pdf and a book
 * hold a text; any other pane is refused with a sentence for the bar.
 */
export function askRsvp(
  pane: Pick<Pane, "id" | "path" | "pdf" | "html" | "book">,
  here: boolean,
  refuse: (why: string) => void,
): void {
  const reads =
    pane.path !== undefined ||
    pane.pdf !== undefined ||
    pane.html !== undefined ||
    pane.book !== undefined;
  if (!reads) {
    refuse("RSVP reads a note, a page, a pdf or a book");
    return;
  }
  asked = { pane: pane.id, here, signal: asked.signal + 1 };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The last press, for the panes to pick out their own. */
export function useRsvpAsked(): { pane: string } & RsvpAsk {
  return useSyncExternalStore(
    subscribe,
    () => asked,
    () => asked,
  );
}

/**
 * Whether the reader is open over this pane, and how it was asked for.
 * The mount count is seen, not acted on, so a remount with a standing press does not reopen the reader.
 */
export function useRsvpAsk(ask: RsvpAsk | undefined): {
  open: RsvpAsk | null;
  close: () => void;
} {
  const seen = useRef(ask?.signal ?? 0);
  const [open, setOpen] = useState<RsvpAsk | null>(null);
  useEffect(() => {
    if (ask === undefined || ask.signal === seen.current) return;
    seen.current = ask.signal;
    setOpen(ask);
  }, [ask]);
  const close = useCallback(() => setOpen(null), []);
  return { open, close };
}
