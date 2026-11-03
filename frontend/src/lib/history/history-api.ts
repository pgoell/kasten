import { client } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

/** One jj change that touched a note, as the history pane lists it. */
export type HistoryChange = components["schemas"]["HistoryChange"];

/** A note's changes, newest first, and whether the vault keeps any at all. */
export type History = components["schemas"]["History"];

/** Every jj change that touched `path`, newest first. */
export async function fetchHistory(path: string): Promise<History> {
  const { data, response } = await client.GET("/api/history", {
    params: { query: { path } },
  });

  if (!data) {
    throw new Error(`GET /api/history failed with ${response.status}`);
  }

  return data;
}

/**
 * The whole note as change `commit` left it. `path` is the name that change lists,
 * not necessarily the note's path now.
 */
export async function fetchHistoryText(path: string, commit: string): Promise<string> {
  const { data, response } = await client.GET("/api/history/version", {
    params: { query: { path, commit } },
  });

  if (!data) {
    throw new Error(`GET /api/history/version failed with ${response.status}`);
  }

  return data.content;
}
