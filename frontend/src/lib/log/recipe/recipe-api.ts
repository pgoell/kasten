/** The recipe notes the food sheet lists, read apart from the food API so its mocks stay whole. */

import type { components } from "@/lib/api-types";
import { client } from "@/lib/core/api-client";

/** A recipe note as the food sheet lists it, with its numbers per serving. */
export type RecipeEntry = components["schemas"]["RecipeEntry"];

/** Every recipe note outside the archive, by title. */
export async function fetchRecipes(): Promise<RecipeEntry[]> {
  const { data, response } = await client.GET("/api/recipes");

  if (!data) {
    throw new Error(`GET /api/recipes failed with ${response.status}`);
  }

  return data;
}
