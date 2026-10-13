import type { TriageFolder } from "@/lib/chat";
import { noteName } from "@/lib/note-path";

/** How many notes a folder shows the runner as examples of what it holds. */
const EXAMPLES = 5;

/** Files kasten writes into a folder itself, which are never a note to file. */
const OWN = ["index.md", "log.md"];

/** The folder a path sits in, `""` for a note at the vault root. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** The file name, the last part of the path. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Notes waiting in the inbox, in the order the vault lists them.
 *
 * The inbox is matched with its trailing slash, so `00 Inbox2/x.md` is not
 * taken for a note in `00 Inbox`.
 */
export function inboxNotes(files: string[], inbox: string): string[] {
  return files.filter((path) => path.startsWith(`${inbox}/`) && !OWN.includes(nameOf(path)));
}

/**
 * Folders a note may be filed in: every folder holding a note, outside the ones named in `skip`.
 *
 * A folder holding only `index.md` or `log.md` is still a place to file into,
 * so it is listed, just with no examples.
 */
export function vaultFolders(files: string[], skip: string[]): TriageFolder[] {
  const folders = new Map<string, string[]>();
  for (const path of files) {
    const folder = folderOf(path);
    if (folder === "") continue;
    if (skip.some((s) => folder === s || folder.startsWith(`${s}/`))) continue;
    if (!folders.has(folder)) folders.set(folder, []);
    const examples = folders.get(folder) ?? [];
    if (!OWN.includes(nameOf(path)) && examples.length < EXAMPLES) {
      examples.push(noteName(path));
    }
  }
  return [...folders]
    .map(([path, examples]) => ({ path, examples }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
