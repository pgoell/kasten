/**
 * What the vault says happened, read off the wire.
 *
 * The parsing lives here rather than beside the `EventSource` that opens the
 * stream, so the whole table of payloads answers to a unit test with no DOM in
 * it. The backend's own `events.py` writes the shape below.
 */

export interface VaultEvent {
  /** Vault-relative path, or "" on a `listing` event, which names none. */
  path: string;
  change: "written" | "removed" | "listing";
  digest: string | null;
}

/**
 * The sha256 of `text`, spelled the way an event's `digest` is spelled.
 *
 * Lowercase hex over the UTF-8 bytes, which is what Python's `hexdigest()` of
 * the file's own bytes gives, so a client can hold what it wrote against what
 * the vault says landed.
 */
export async function digestOf(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The kinds this build acts on. A backend saying anything else is ignored. */
const KINDS: ReadonlySet<string> = new Set(["written", "removed", "listing"]);

/** One SSE payload, or null when it is not an event this build understands. */
export function parseVaultEvent(data: string): VaultEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch (error) {
    // The only thing `JSON.parse` throws, and the one thing a truncated
    // payload arrives as. Anything else came from somewhere this cannot fix.
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }

  // Every field, not only the kind. This is where the wire meets the app, and
  // an event half-checked is one the callers below read `path` off as a string
  // it never was. An unknown kind is the ordinary case among these: it is how
  // an older frontend meets a newer backend, and it goes by quietly.
  //
  // The null is asked first because it is the one shape that throws rather than
  // failing a test: JSON holds `null`, and reading a field off it raises. Every
  // other non-event, a number, a string, an array, an object short of a field,
  // simply has no `path` and falls out here.
  const event = payload as VaultEvent | null;
  return event !== null &&
    typeof event.path === "string" &&
    KINDS.has(event.change) &&
    (event.digest === null || typeof event.digest === "string")
    ? event
    : null;
}
