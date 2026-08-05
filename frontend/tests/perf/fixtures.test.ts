import { syntheticVault } from "../../bench/fixtures";

const N = 500;

// The generator's own split, restated here so the test fails when the shape
// drifts rather than mirroring whatever the implementation happens to do.
const D1 = Math.ceil(N / 3);
const D2 = Math.ceil((N - D1) / 2);
const D3 = N - D1 - D2;

/** Every directory prefix of `paths`, deduped, each ending in "/". */
function directoryPrefixes(paths: string[]): Set<string> {
  const prefixes = new Set<string>();

  for (const path of paths) {
    let prefix = "";
    for (const segment of path.split("/").slice(0, -1)) {
      prefix += `${segment}/`;
      prefixes.add(prefix);
    }
  }
  return prefixes;
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

  it("opens a new nested folder every eight notes", () => {
    const counts = notesPerFolder(syntheticVault(N).paths);

    for (const [folder, count] of counts) {
      // Top folders take a third of the vault between the eight of them. The
      // fan-out rule is about the folders below them, which is where the folder
      // count the prompt pays for actually grows.
      const nested = /\/[su]\d+\/$/.test(folder);
      if (nested) expect(count).toBeLessThanOrEqual(8);
    }
  });

  it("counts the folders the paths actually name", () => {
    const vault = syntheticVault(N);

    expect(vault.folderCount).toBe(directoryPrefixes(vault.paths).size);
  });

  it("serves the paths sorted, as the vault listing does", () => {
    const { paths } = syntheticVault(N);

    expect(paths).toEqual([...paths].sort());
  });

  it("returns the same vault for the same count", () => {
    expect(syntheticVault(N)).toEqual(syntheticVault(N));
  });
});
