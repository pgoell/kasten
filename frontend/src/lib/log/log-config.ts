/**
 * The config in log.md, held once for every reader. Each card's kinds and the
 * palette's `Log` rows both draw from here, so they cannot disagree about what
 * the note says, and a late answer cannot reach one reader and not the other.
 */

import { fetchNote, NoteMissing } from "@/lib/api";
import { LOG_NOTE } from "@/lib/layout";
import { type LogConfig, parseConfig } from "@/lib/log/log-kinds";

/** The last good config, or null before the first answer. */
let config: LogConfig | null = null;

const listeners = new Set<() => void>();

/** The number of the newest read started. */
let latest = 0;
/** The number of the read whose answer `config` holds. A read numbered at or below it is dropped. */
let drawn = 0;
/** The numbers of the reads still out. */
const out = new Set<number>();

/** The config as it stands, or null before the first answer. */
export function logConfig(): LogConfig | null {
  return config;
}

/**
 * Reads log.md as a new read, numbered after every read before it. An answer
 * lands only when no newer one has, so a slow older read cannot overwrite a newer
 * one. A failed read keeps the config it has. Never rejects, so nothing is unhandled.
 */
function read(): void {
  const number = ++latest;
  out.add(number);
  fetchNote(LOG_NOTE)
    .then(parseConfig, (error: unknown) => {
      if (error instanceof NoteMissing) return parseConfig(null);
      throw error;
    })
    .then(
      (arrived) => {
        out.delete(number);
        if (number <= drawn) return;
        drawn = number;
        config = arrived;
        for (const listener of listeners) listener();
      },
      (error: unknown) => {
        out.delete(number);
        if (error instanceof Error) console.warn(error.message);
      },
    );
}

/**
 * Starts a read when there is no config and none is out. A reader that draws the
 * config asks for it; a listener alone does not, so a note with no card reads nothing.
 */
export function askLogConfig(): void {
  if (config === null && out.size === 0) read();
}

/** Adds a listener, called each time the store draws a good answer. */
export function subscribeLogConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) queueMicrotask(forgetIfUnused);
  };
}

/**
 * Drops the config once nobody reads it, so a closed app or a test starts fresh.
 * It waits a microtask: a card taken out and put back in the same tick keeps its
 * config and does not read again, which a redraw of the card relies on.
 */
function forgetIfUnused(): void {
  if (listeners.size > 0) return;
  config = null;
  // Every read out is numbered at or below `latest`, so this drops each of them.
  drawn = latest;
  out.clear();
}

/** Asks log.md again, even while a read is out: the write that asked has a newer answer. */
export function reloadLogConfig(): void {
  read();
}
