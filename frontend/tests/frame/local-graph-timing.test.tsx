/**
 * How long the margin's graph takes to paint its first frame (#781), timed on the two
 * notes the dev vault's `/api/graph` answers for. Skipped unless VITE_KASTEN_TIMING=1.
 *
 * The answers are pasted in from `/api/graph` with `depth=1`, because the browser
 * cannot reach the backend from here. Each draw is a fresh canvas in a 256 px box:
 * the update, then two animation frames, the second being the first painted one.
 */

import type { GraphEdge, GraphNode } from "@/lib/graph";
import { drawGraph } from "@/lib/graph-canvas";

const RUNS = 20;

const INBOX = {
  nodes: [
    {
      path: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      name: "How-To-Inbox",
      type: "Note",
      tags: [],
      missing: false,
    },
    {
      path: "99 Misc/01 Config/01 Agents/How-To-Index.md",
      name: "How-To-Index",
      type: "Reference",
      tags: [],
      missing: false,
    },
    {
      path: "99 Misc/01 Config/01 Agents/How-To-TODO.md",
      name: "How-To-TODO",
      type: "Note",
      tags: [],
      missing: false,
    },
    {
      path: "99 Misc/01 Config/01 Agents/Ontology.md",
      name: "Ontology",
      type: "Reference",
      tags: [],
      missing: false,
    },
    { path: "wikilinks.md", name: "wikilinks", type: null, tags: [], missing: true },
    { path: "wikilink.md", name: "wikilink", type: null, tags: [], missing: true },
    {
      path: "Ridgeline Migration.md",
      name: "Ridgeline Migration",
      type: null,
      tags: [],
      missing: true,
    },
    { path: "note.md", name: "note", type: null, tags: [], missing: true },
    { path: "link.md", name: "link", type: null, tags: [], missing: true },
    { path: "name.md", name: "name", type: null, tags: [], missing: true },
    { path: "links.md", name: "links", type: null, tags: [], missing: true },
    { path: "<target name>.md", name: "<target name>", type: null, tags: [], missing: true },
  ] satisfies GraphNode[],
  edges: [
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      target: "wikilink.md",
      relation: null,
      line: 11,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      target: "wikilinks.md",
      relation: null,
      line: 34,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      target: "Ridgeline Migration.md",
      relation: null,
      line: 38,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      target: "note.md",
      relation: null,
      line: 51,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      target: "99 Misc/01 Config/01 Agents/Ontology.md",
      relation: null,
      line: 60,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      target: "99 Misc/01 Config/01 Agents/How-To-TODO.md",
      relation: null,
      line: 62,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      target: "link.md",
      relation: null,
      line: 190,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      target: "name.md",
      relation: null,
      line: 194,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      target: "links.md",
      relation: null,
      line: 200,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      target: "<target name>.md",
      relation: null,
      line: 209,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Inbox.md",
      target: "99 Misc/01 Config/01 Agents/How-To-Index.md",
      relation: null,
      line: 222,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Index.md",
      target: "wikilinks.md",
      relation: null,
      line: 53,
    },
    {
      source: "99 Misc/01 Config/01 Agents/How-To-Index.md",
      target: "wikilink.md",
      relation: null,
      line: 108,
    },
  ] satisfies GraphEdge[],
};

const CCAR = {
  nodes: [
    {
      path: "02 Projects/Anthropic Certifications/ccar-p-practice-exam.md",
      name: "ccar-p-practice-exam",
      type: "Note",
      tags: [],
      missing: false,
    },
  ] satisfies GraphNode[],
  edges: [] satisfies GraphEdge[],
};

const NOTES = [
  { name: "How-To-Inbox", answer: INBOX, centre: "99 Misc/01 Config/01 Agents/How-To-Inbox.md" },
  {
    name: "ccar-p-practice-exam",
    answer: CCAR,
    centre: "02 Projects/Anthropic Certifications/ccar-p-practice-exam.md",
  },
] as const;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The middle of a sorted list, averaged over the two middles of an even one. */
function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

it.skipIf(!import.meta.env.VITE_KASTEN_TIMING)(
  "timing the margin graph first painted frame",
  async () => {
    for (const { name, answer, centre } of NOTES) {
      const sync: number[] = [];
      const painted: number[] = [];
      for (let run = 0; run < RUNS; run++) {
        const box = document.body.appendChild(document.createElement("div"));
        box.style.position = "relative";
        box.style.width = "256px";
        box.style.height = "256px";

        const start = performance.now();
        const made = drawGraph(
          box,
          { onOpen: () => {}, onBlank: () => {}, coarse: () => false },
          { radial: true },
        );
        made.update(structuredClone(answer.nodes), structuredClone(answer.edges), centre);
        sync.push(performance.now() - start);
        await frame();
        await frame();
        painted.push(performance.now() - start);

        made.destroy();
        box.remove();
      }
      const bySize = (values: number[]) => [...values].sort((a, b) => a - b);
      const syncSorted = bySize(sync);
      const paintSorted = bySize(painted);
      // The browser's log and info levels are not shown by this runner, and error is.
      console.error(
        `${name}: ${answer.nodes.length} nodes, ${answer.edges.length} edges, sync median ${median(syncSorted).toFixed(2)} ms max ${(syncSorted[syncSorted.length - 1] ?? 0).toFixed(2)} ms, first paint median ${median(paintSorted).toFixed(1)} ms max ${(paintSorted[paintSorted.length - 1] ?? 0).toFixed(1)} ms, over ${RUNS} draws`,
      );
    }
  },
  120_000,
);
