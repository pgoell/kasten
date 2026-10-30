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
