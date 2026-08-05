/**
 * A synthetic vault, shared by every performance harness.
 *
 * Deterministic, so a number recorded on one machine can be read against a
 * number recorded on another. Names are drawn from the pools below rather than
 * written as `t3/s2/`, because `score` walks the whole candidate and folder
 * names two characters long would put every recorded number well under what a
 * real vault costs.
 */

/** Top folders. Enough to spread the vault, few enough to stay realistic. */
const TOPS = 8;
/** Notes a nested folder holds before the next one opens. */
const FANOUT = 8;

/** One word per top folder, so exactly `TOPS` of them and none needs a lap. */
const TOP_NAMES = [
  "projects",
  "journal",
  "reference",
  "archive",
  "inbox",
  "meetings",
  "resources",
  "templates",
];

const SUB_NAMES = [
  "client-work",
  "personal",
  "reading-notes",
  "design-docs",
  "retros",
  "onboarding",
  "user-research",
  "product-specs",
  "release-notes",
  "postmortems",
  "data-pipeline",
  "team-rituals",
  "book-notes",
  "talks",
  "interviews",
  "experiments",
];

const LEAF_NAMES = [
  "drafts",
  "published",
  "diagrams",
  "questions",
  "benchmarks",
  "migrations",
  "highlights",
  "checklists",
  "estimates",
  "decisions",
  "follow-ups",
  "transcripts",
  "scratch",
  "outlines",
  "clippings",
  "summaries",
];

const NOTE_NAMES = [
  "meeting-notes",
  "weekly-review",
  "reading-list",
  "design-review",
  "open-questions",
  "kickoff",
  "roadmap",
  "runbook",
  "incident-report",
  "one-on-one",
  "quarterly-plan",
  "idea-dump",
  "release-checklist",
  "architecture",
  "daily-log",
  "retro",
];

/**
 * The `index`th name of `pool`, wrapping, with the lap appended once the pool
 * runs out. Distinct indexes give distinct names, which is what holds the
 * folder count to what the fan-out predicts.
 */
function named(pool: string[], index: number): string {
  const word = pool[index % pool.length] ?? "";
  const lap = Math.floor(index / pool.length);
  return lap === 0 ? word : `${word}-${lap}`;
}

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
    paths.push(`${named(TOP_NAMES, i % TOPS)}/${named(NOTE_NAMES, i)}.md`);
  }
  for (let i = 0; i < d2; i += 1) {
    const group = Math.floor(i / FANOUT);
    const top = named(TOP_NAMES, group % TOPS);
    const sub = named(SUB_NAMES, Math.floor(group / TOPS));
    paths.push(`${top}/${sub}/${named(NOTE_NAMES, i)}.md`);
  }
  for (let i = 0; i < d3; i += 1) {
    const group = Math.floor(i / FANOUT);
    const top = named(TOP_NAMES, group % TOPS);
    const sub = named(SUB_NAMES, Math.floor(group / TOPS) % TOPS);
    const leaf = named(LEAF_NAMES, Math.floor(group / (TOPS * TOPS)));
    paths.push(`${top}/${sub}/${leaf}/${named(NOTE_NAMES, i)}.md`);
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
