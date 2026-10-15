import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { unstamped } from "@/lib/held-text";

/**
 * The base a write names for `text`: sha256 of `unstamped(text)`, the way the
 * backend hashes the note on disk before a conditional `PUT`.
 *
 * Synchronous, and not `crypto.subtle`: the write on page hide has to name its
 * base in the same task, and a hash that answers later finishes in any order
 * against the writes around it. It also works over plain http, where
 * `crypto.subtle` is missing.
 */
export function noteBase(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(unstamped(text))));
}
