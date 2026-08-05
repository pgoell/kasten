import createClient from "openapi-fetch";
import type { paths } from "@/lib/api-types";

/**
 * Calls into the backend, typed from its OpenAPI schema.
 *
 * Run `mise run fe:types` after changing a route to regenerate `api-types.ts`.
 */
const client = createClient<paths>();

/** Vault-relative paths of every note, sorted by the backend. */
export async function fetchFiles(): Promise<string[]> {
  const { data, response } = await client.GET("/api/files");

  if (!data) {
    throw new Error(`GET /api/files failed with ${response.status}`);
  }

  return data;
}
