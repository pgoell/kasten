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

  // A kind nobody here knows is how an older frontend meets a newer backend,
  // and the same test throws out anything that is not an event at all.
  const event = payload as VaultEvent | null;
  return event !== null && KINDS.has(event.change) ? event : null;
}
