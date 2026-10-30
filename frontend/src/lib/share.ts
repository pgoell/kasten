/**
 * What Android's share sheet hands the capture page (the manifest's share_target).
 * Apps fill title, text or url unevenly, so no field is trusted to hold the address.
 */

export interface Shared {
  title?: string;
  text?: string;
  url?: string;
}

/** An address in prose runs from its scheme to the next space. */
const ADDRESS = /https?:\/\/\S+/i;

/**
 * Each field that says something, once, one per line: title first, address last.
 * An address already in `text` is not repeated.
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
