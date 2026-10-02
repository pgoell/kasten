/**
 * The folders the editor files into or looks in, as this vault names them.
 *
 * The backend owns them, as `KASTEN_*_PATH` settings, and `GET /api/layout`
 * hands them over once when the app starts. Until it answers, and in every test
 * that does not ask, these hold the defaults, which are the backend's defaults
 * too. A vault on the default layout therefore never sees a difference between
 * before and after the answer.
 *
 * Exported as `let` bindings rather than one object, because ES modules keep a
 * re-exported binding live: `ARCHIVE` in `archive.ts` and `IMAGE_FOLDER` in
 * `image.ts` read the new value the moment `applyLayout` runs, and no caller of
 * either had to change. Every reader reads one at call time, never at import.
 */

import type { components } from "@/lib/api-types";

export type Layout = components["schemas"]["Layout"];

/** The folder for a note with nowhere to be yet. */
export let INBOX = "00 Inbox";

/** The folder holding the five kinds of periodic note, one folder each. */
export let PERIODIC = "01 Periodic";

/** The folder holding what is finished, which browsing leaves out. */
export let ARCHIVE = "98 Archive";

/** The folder a pasted image is written into. */
export let IMAGE_FOLDER = "99 Misc/02 Assets/01 Images";

/** Where the vocabulary lives, which the route reads and the completion offers. */
export let ONTOLOGY_NOTE = "99 Misc/01 Config/01 Agents/Ontology.md";

/** Where the vault keeps its named filters. One note, not a setting. */
export let VIEWS_NOTE = "99 Misc/01 Config/todo-views.md";

/** Take the folders the backend named, from here on. */
export function applyLayout(layout: Layout): void {
  INBOX = layout.inbox;
  PERIODIC = layout.periodic;
  ARCHIVE = layout.archive;
  IMAGE_FOLDER = layout.images;
  ONTOLOGY_NOTE = `${layout.config}/01 Agents/Ontology.md`;
  VIEWS_NOTE = `${layout.config}/todo-views.md`;
}
