/**
 * Import rules for the frontend, run by `mise run lint:imports`.
 *
 * Today's breaches sit in .dependency-cruiser-known-violations.json, so only a
 * new one fails. After fixing one, refresh that file from frontend/:
 *   node_modules/.bin/depcruise src sw scripts --config .dependency-cruiser.cjs --output-type baseline > .dependency-cruiser-known-violations.json
 * then `bunx biome format --write .dependency-cruiser-known-violations.json`, so `biome check` passes.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular import. Fix: move the shared part into a module that both files import, so the cycle breaks.",
      from: {},
      to: { circular: true },
    },
    {
      name: "lib-not-up",
      severity: "error",
      comment:
        "src/lib is the lower layer and must not import src/components or src/routes. Fix: pass what lib needs in as an argument, or move the shared type into src/lib.",
      from: { path: "^src/lib/" },
      to: { path: "^src/(components|routes)/" },
    },
    {
      name: "components-not-routes",
      severity: "error",
      comment:
        "src/components must not import src/routes. Fix: move the shared code into src/components or src/lib, and let the route import it.",
      from: { path: "^src/components/" },
      to: { path: "^src/routes/" },
    },
    {
      name: "lists-apart",
      severity: "error",
      comment:
        "The lists app (src/lists, its own entry lists.html) must not import the notebook (src/lib, src/components, src/routes). Fix: move the shared code into src/lists, or into a module the lists app owns.",
      from: { path: "^src/lists/" },
      to: { path: "^src/(lib|components|routes)/" },
    },
    {
      name: "notebook-not-lists",
      severity: "error",
      comment:
        "The notebook must not import the lists app (src/lists). Fix: move the shared code out of src/lists into src/lib.",
      from: { pathNot: "^src/lists/" },
      to: { path: "^src/lists/" },
    },
    {
      name: "no-dynamic-import",
      severity: "error",
      comment:
        "No dynamic imports (.claude/CLAUDE.md): import at the top of the file. The only exception is a heavy third-party bundle loaded on demand (pdf.js, KaTeX, mermaid, zxing), listed in .dependency-cruiser-known-violations.json with a comment at the import.",
      from: {},
      to: { dynamic: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    // swc, not the default tsc: dependency-cruiser's tsc path does not support TypeScript 7 yet.
    parser: "swc",
  },
};
