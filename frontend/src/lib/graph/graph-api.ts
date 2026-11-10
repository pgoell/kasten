import type { components } from "@/lib/api-types";
import { client, reason } from "@/lib/core/api-client";
import { loadOnce } from "@/lib/core/load-once";

/** The notes as a graph, and for a pattern the rows it matched. */
export type Graph = components["schemas"]["Graph"];

/** What the graph pane asks: a query, and for a local graph the note it is around. */
export interface GraphAsk {
  query: string;
  /** The note a local graph is drawn around, absent for the whole vault. */
  around?: string;
  /** How many links out from `around` the drawing reaches. */
  depth?: number;
  archive?: boolean;
}

/**
 * The notes as a graph. The query goes over as typed: the backend is the one parser,
 * so a query it cannot read throws its own sentence, which the pane shows under the filter.
 */
export async function fetchGraph({
  query,
  around,
  depth,
  archive = false,
}: GraphAsk): Promise<Graph> {
  const { data, error, response } = await client.GET("/api/graph", {
    params: { query: { q: query, around, depth, archive } },
  });

  if (!data) {
    throw new Error(reason(error) ?? `GET /api/graph failed with ${response.status}`);
  }

  return data;
}

// A dynamic import as pdf.js's: force-graph and d3 are heavy, and only a drawn graph needs
// them. A failed load is forgotten, so the next graph asks again.
export const loadGraphCanvas = loadOnce(() => import("@/lib/graph/graph-canvas"));

/** What a graph shows when its chunk did not load, as on a tab left open across a release. */
export const GRAPH_LOST = "The graph could not load. Reload the page to draw it.";

/** Calls `lose` when the chunk did not load: an import rejects with an Error. Anything else is thrown on. */
export function lostLoad(lose: () => void): (error: unknown) => void {
  return (error) => {
    if (!(error instanceof Error)) throw error;
    lose();
  };
}
