import { client, reason } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

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
