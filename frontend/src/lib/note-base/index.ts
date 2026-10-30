import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { unstamped } from "@/lib/held-text";

/**
 * sha256 of `unstamped(text)`, the hash the backend makes of the note on disk.
 * Sync, not `crypto.subtle`: a write on page hide names its base in the same
 * task, and plain http has no `crypto.subtle`.
 */
export function noteBase(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(unstamped(text))));
}

let worker: Worker | null = null;
let asked = 0;
const waiting = new Map<number, { text: string; done: (base: string) => void }>();

/**
 * `noteBase` in a worker, so a 1 MB note's hash is no long task on a phone (#1384).
 * Where no worker can start it hashes here and answers the string at once; one that fails hashes here too.
 */
export function noteBaseAside(text: string): string | Promise<string> {
  const hashing = worker ?? started();
  if (hashing === null) return noteBase(text);
  return new Promise((done) => {
    const id = ++asked;
    waiting.set(id, { text, done });
    try {
      hashing.postMessage({ id, text });
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
      failed();
    }
  });
}

function started(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    // A page whose policy refuses workers throws a SecurityError here.
    if (error instanceof DOMException) return null;
    throw error;
  }
  worker.onmessage = ({ data }: MessageEvent<{ id: number; base: string }>) => {
    const asking = waiting.get(data.id);
    waiting.delete(data.id);
    asking?.done(data.base);
  };
  worker.onerror = failed;
  worker.onmessageerror = failed;
  return worker;
}

/** Drops the worker and answers whatever it held here; the next ask starts a new one. */
function failed(): void {
  worker?.terminate();
  worker = null;
  const held = [...waiting.values()];
  waiting.clear();
  for (const { text, done } of held) done(noteBase(text));
}
