/**
 * What a vault of a given size costs the code that reads all of it, recorded
 * across four sizes.
 *
 * `rankFolders` and `describeNotePath` are what the note prompt pays per
 * keystroke. `buildTree` belongs to the file explorer and runs on load, not on
 * a keystroke; it is here because it reads the same paths and its cost sets
 * what the vault size does to first paint.
 *
 * These numbers gate nothing. `vitest bench` has no threshold and no way to
 * exit non-zero, so the assertions live in `tests/perf/` and this file only
 * records. Run it with `mise run fe:bench`, which pins the perf project: it is
 * the only one that turns `benchmark.include` on, and it is the node one, so
 * every recorded number comes from the same environment.
 */

import { bench, describe } from "vitest";
import { buildTree } from "@/components/file-explorer";
import { rankFolders } from "@/lib/fuzzy";
import { describeNotePath } from "@/lib/note-path";
import { syntheticVault, VAULT_SIZES } from "./fixtures";

/** A query about a quarter of the folders match at every size: 10 of 50, 40 of
 * 176, 194 of 842 and 1110 of 4176. A query matching nothing would measure
 * scoring alone, because the sort and the map that follow it would never see an
 * entry, and those are the expensive tail of a real keystroke. */
const QUERY = "notes";

/** A folder that exists and a note name that does not, which is where the
 * prompt sits for most of the typing. */
const TYPED = "archive/client-work/a new note";

for (const notes of VAULT_SIZES) {
  const { paths, folderCount } = syntheticVault(notes);

  describe(`${notes} notes, ${folderCount} folders`, () => {
    bench("rankFolders, empty query", () => {
      rankFolders(paths, "");
    });

    bench("rankFolders, typed query", () => {
      rankFolders(paths, QUERY);
    });

    bench("describeNotePath", () => {
      describeNotePath(TYPED, paths);
    });

    bench("buildTree", () => {
      buildTree(paths);
    });
  });
}
