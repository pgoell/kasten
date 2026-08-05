/**
 * What the note prompt pays per keystroke, recorded across vault sizes.
 *
 * These numbers gate nothing. `vitest bench` has no threshold and no way to
 * exit non-zero, so the assertions live in `tests/perf/` and this file only
 * records. Run it with `mise run fe:bench`, which pins the perf project;
 * unpinned, `benchmark.include` fans the same file out across every project.
 */

import { bench, describe } from "vitest";
import { buildTree } from "@/components/file-explorer";
import { rankFolders } from "@/lib/fuzzy";
import { describeNotePath } from "@/lib/note-path";
import { syntheticVault, VAULT_SIZES } from "./fixtures";

/** Eight characters, and a word no synthetic folder carries, so the scorer
 * walks every candidate to its end rather than stopping early. */
const QUERY = "projects";

/** A folder that exists and a note name that does not, which is where the
 * prompt sits for most of the typing. */
const TYPED = "t3/s2/a new note";

for (const notes of VAULT_SIZES) {
  const { paths, folderCount } = syntheticVault(notes);

  describe(`${notes} notes, ${folderCount} folders`, () => {
    bench("rankFolders, empty query", () => {
      rankFolders(paths, "");
    });

    bench("rankFolders, 8 characters", () => {
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
