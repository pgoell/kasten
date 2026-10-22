import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The commit the tree is on, in seven characters, or nothing without one.
 *
 * Read here and stamped into the bundle, because the browser has no repo to
 * ask. Read out of `.git` rather than run through `git`, which the build image
 * has not got. Production copies only `frontend/` into that image, so there is
 * nothing to read there and the status bar shows the backend's release alone.
 */
export function buildId(): string {
  const git = path.resolve(import.meta.dirname, "..", ".git");
  const head = path.join(git, "HEAD");
  if (!existsSync(head)) return "";

  const named = readFileSync(head, "utf8").trim();
  // A detached HEAD holds the commit itself, which is what a checkout of a tag
  // leaves behind.
  if (!named.startsWith("ref: ")) return named.slice(0, 7);

  // A ref `git gc` has packed away has no loose file. Rare on a working tree,
  // and saying nothing beats parsing `packed-refs` for it.
  const loose = path.join(git, named.slice("ref: ".length));
  return existsSync(loose) ? readFileSync(loose, "utf8").trim().slice(0, 7) : "";
}
