/**
 * What a vault of a given size costs the code that reads all of it, recorded
 * across four sizes.
 *
 * `rankFolders` and `describeNotePath` are what the note prompt pays per
 * keystroke, and `rankCandidates` over notes is what the finder pays. The
 * `Candidates` pair are the halves each surface derives once per vault rather
 * than once per keystroke, recorded apart so a regression in either half cannot
 * hide behind the other. `buildTree` belongs to the file explorer and runs on
 * load, not on a keystroke; it is here because it reads the same paths and its
 * cost sets what the vault size does to first paint.
 *
 * These numbers gate nothing. `vitest bench` has no threshold and no way to
 * exit non-zero, so the assertions live in `tests/perf/` and this file only
 * records. Run it with `mise run fe:bench`, which pins the perf project: it is
 * the only one that turns `benchmark.include` on, and it is the node one, so
 * every recorded number comes from the same environment.
 */

import { bench, describe } from "vitest";
import { buildTree } from "@/components/file-explorer";
import { folderCandidates, noteCandidates, rankCandidates, rankFolders } from "@/lib/fuzzy";
import { describeNotePath } from "@/lib/note-path";
import { syntheticVault, VAULT_SIZES } from "./fixtures";

/** A query about a quarter of the folders match at every size: 10 of 50, 40 of
 * 176, 194 of 842 and 1110 of 4176. A query matching nothing would measure
 * scoring alone, because the sort and the map that follow it would never see an
 * entry, and those are the expensive tail of a real keystroke. */
const QUERY = "notes";

/** A folder that exists and a note name that does not, which is where the
 * prompt sits for most of the typing. `projects` is the middle of the eight top
 * folders in sort order, and that choice is load-bearing: `describeNotePath`
 * decides a folder exists by scanning the sorted paths for the first one
 * carrying the prefix, so the top folder's name sets how far the scan runs.
 * `archive` sorts first and stops almost at once, `templates` sorts last and
 * reads nearly the whole vault, and at 10,000 notes those two ends are 2x
 * apart. A middle folder records what a typical keystroke pays. */
const TYPED = "projects/client-work/a new note";

/** The first letter typed, which is the dearest keystroke the finder answers:
 * one letter rejects almost nothing, so nearly every note pays for the scoring
 * table, where a longer query throws most of the vault out on the cheap scan
 * that runs before it. */
const LETTER = "a";

for (const notes of VAULT_SIZES) {
  const { paths, folderCount } = syntheticVault(notes);

  const folders = folderCandidates(paths);
  const prepared = noteCandidates(paths);

  describe(`${notes} notes, ${folderCount} folders`, () => {
    bench("rankFolders, empty query", () => {
      rankFolders(paths, "");
    });

    bench("rankFolders, typed query", () => {
      rankFolders(paths, QUERY);
    });

    bench("folderCandidates", () => {
      folderCandidates(paths);
    });

    bench("rankCandidates over folders, empty query", () => {
      rankCandidates(folders, "");
    });

    bench("noteCandidates", () => {
      noteCandidates(paths);
    });

    bench("rankCandidates over notes, empty query", () => {
      rankCandidates(prepared, "");
    });

    bench("rankCandidates over notes, one letter", () => {
      rankCandidates(prepared, LETTER);
    });

    bench("rankCandidates over notes, typed query", () => {
      rankCandidates(prepared, QUERY);
    });

    bench("describeNotePath", () => {
      describeNotePath(TYPED, paths);
    });

    bench("buildTree", () => {
      buildTree(paths);
    });
  });
}
