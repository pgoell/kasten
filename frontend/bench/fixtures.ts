/**
 * A synthetic vault, shared by every performance harness.
 *
 * Deterministic and without randomness, so a number recorded on one machine
 * can be read against a number recorded on another.
 */

/** Top folders. Enough to spread the vault, few enough to stay realistic. */
const TOPS = 8;
/** Notes a nested folder holds before the next one opens. */
const FANOUT = 8;

export interface VaultShape {
  /** Vault-relative paths of every note, sorted, as GET /api/files serves them. */
  paths: string[];
  /** Distinct folder prefixes. The number the prompt's cost actually tracks. */
  folderCount: number;
}

/** Vault sizes every recorded table and every gate is measured at. */
export const VAULT_SIZES: readonly number[] = [500, 2000, 10000, 50000];

export function syntheticVault(noteCount: number): VaultShape {
  // Thirds, so a third of the vault sits at each of three depths and the
  // folder count grows with the note count rather than flattening out.
  const d1 = Math.ceil(noteCount / 3);
  const d2 = Math.ceil((noteCount - d1) / 2);
  const d3 = noteCount - d1 - d2;
  const paths: string[] = [];

  for (let i = 0; i < d1; i += 1) {
    paths.push(`t${i % TOPS}/n${i}.md`);
  }
  for (let i = 0; i < d2; i += 1) {
    const group = Math.floor(i / FANOUT);
    paths.push(`t${group % TOPS}/s${Math.floor(group / TOPS)}/n${i}.md`);
  }
  for (let i = 0; i < d3; i += 1) {
    const group = Math.floor(i / FANOUT);
    const top = group % TOPS;
    const sub = Math.floor(group / TOPS) % TOPS;
    paths.push(`t${top}/s${sub}/u${Math.floor(group / (TOPS * TOPS))}/n${i}.md`);
  }
  paths.sort();

  const folders = new Set<string>();
  for (const path of paths) {
    let prefix = "";
    for (const segment of path.split("/").slice(0, -1)) {
      prefix += `${segment}/`;
      folders.add(prefix);
    }
  }

  return { paths, folderCount: folders.size };
}
