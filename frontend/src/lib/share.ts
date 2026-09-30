/**
 * What another app hands the capture page through Android's share sheet.
 *
 * The manifest's `share_target` opens `/capture?title=…&text=…&url=…`, and
 * which of the three a sharing app fills is up to that app. Chrome sharing a
 * page puts the address in `text` and leaves `url` empty, a note app puts
 * everything in `text`, and some fill `url` alone. So nothing here trusts one
 * field to hold the address.
 */

export interface Shared {
  title?: string;
  text?: string;
  url?: string;
}

/** An address as a line of prose holds one: the scheme up to the next space. */
const ADDRESS = /https?:\/\/\S+/i;

/**
 * The text the textarea starts holding: every field that says something, once.
 *
 * One per line, so the title reads as the thought's first line and the address
 * as its last. An address already inside `text` is not repeated, which is what
 * Chrome's own share would otherwise do.
 */
export function sharedDraft({ title, text, url }: Shared): string {
  const said = [title, text].map((part) => part?.trim() ?? "").filter((part) => part !== "");
  const address = url?.trim() ?? "";
  if (address !== "" && !said.some((part) => part.includes(address))) said.push(address);
  return said.join("\n");
}

/** The first web address in `text`, or null where it holds none. */
export function firstAddress(text: string): string | null {
  return ADDRESS.exec(text)?.[0] ?? null;
}
