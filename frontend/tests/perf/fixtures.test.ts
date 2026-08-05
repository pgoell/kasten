import { syntheticVault, VAULT_SIZES } from "../../bench/fixtures";

const N = 500;

// The split at N = 500, as numbers rather than the generator's own formulas,
// so a change to the shape has to be admitted here instead of followed.
const D1 = 167;
const D2 = 167;
const D3 = 166;

/** How many folders the paths name at each depth, top level first. */
function foldersByDepth(paths: string[]): number[] {
  const prefixes = new Set<string>();

  for (const path of paths) {
    let prefix = "";
    for (const segment of path.split("/").slice(0, -1)) {
      prefix += `${segment}/`;
      prefixes.add(prefix);
    }
  }

  const counts = [0, 0, 0];
  for (const prefix of prefixes) {
    const depth = prefix.split("/").length - 2;
    counts[depth] = (counts[depth] ?? 0) + 1;
  }
  return counts;
}

/** How many notes sit directly in each folder, keyed by the folder's prefix. */
function notesPerFolder(paths: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const path of paths) {
    const cut = path.lastIndexOf("/");
    const folder = path.slice(0, cut + 1);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return counts;
}

describe("syntheticVault", () => {
  it("yields one path per note asked for", () => {
    expect(syntheticVault(N).paths).toHaveLength(N);
  });

  it("names every note as a markdown file", () => {
    expect(syntheticVault(N).paths.every((path) => path.endsWith(".md"))).toBe(true);
  });

  it("spreads the vault across eight top folders", () => {
    const tops = new Set(syntheticVault(N).paths.map((path) => path.split("/")[0]));

    expect(tops.size).toBe(8);
  });

  it("splits the notes into three depths as evenly as the count allows", () => {
    const depths = syntheticVault(N).paths.map((path) => path.split("/").length);

    expect(depths.filter((depth) => depth === 2)).toHaveLength(D1);
    expect(depths.filter((depth) => depth === 3)).toHaveLength(D2);
    expect(depths.filter((depth) => depth === 4)).toHaveLength(D3);
  });

  it("opens twenty-one folders at each nested level for five hundred notes", () => {
    // 167 notes at depth two and 166 at depth three, eight to a folder, so 21
    // folders at each level. A wider or narrower fan-out lands elsewhere.
    expect(foldersByDepth(syntheticVault(N).paths)).toEqual([8, 21, 21]);
  });

  it("opens a new folder every eight notes below the top level", () => {
    const counts = notesPerFolder(syntheticVault(N).paths);
    // Top folders take a third of the vault between the eight of them. The
    // fan-out rule is about the folders below them, which is where the folder
    // count the prompt pays for actually grows. Depth picks them out rather
    // than their names, so renaming a folder cannot empty this list and leave
    // the assertion below with nothing to say.
    const nested = [...counts].filter(([folder]) => folder.split("/").length > 2);

    expect(nested).toHaveLength(42);
    for (const [, count] of nested) expect(count).toBeLessThanOrEqual(8);
  });

  it("counts the folders the fan-out predicts at every vault size", () => {
    // 500, 2000, 10000 and 50000 notes. These are the numbers every recorded
    // table's folders column carries, so they are stated rather than derived.
    expect(VAULT_SIZES.map((notes) => syntheticVault(notes).folderCount)).toEqual([
      50, 176, 842, 4176,
    ]);
  });

  it("serves the paths sorted, as the vault listing does", () => {
    const { paths } = syntheticVault(N);

    expect(paths).toEqual([...paths].sort());
  });

  it("gives every note a path of its own", () => {
    const { paths } = syntheticVault(N);

    expect(new Set(paths).size).toBe(N);
  });

  it("returns the same vault for the same count", () => {
    expect(syntheticVault(N)).toEqual(syntheticVault(N));
  });
});
