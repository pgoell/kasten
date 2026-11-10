/**
 * A shared recipe into a recipe note (#1725). A link to a recipe site is read by the backend;
 * a caption, or a link to a social post beside its text, goes to the model in the shell's chat
 * runner first, and its schema.org JSON to the same import. The note format is
 * `docs/reference/food/recipe-note.md`.
 */

import type { components } from "@/lib/api-types";
import { client, reason } from "@/lib/core/api-client";
import { firstAddress } from "./share";

export type ImportedNote = components["schemas"]["ImportedNote"];

/** Hosts whose pages carry no recipe data and may not be scraped; their captions come by paste. */
const SOCIAL = /(^|\.)(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com)$/i;

/** Whether the text is read by the model rather than fetched: a caption, not a recipe page. */
export function needsReading(text: string): boolean {
  const address = firstAddress(text);
  if (address === null || !URL.canParse(address)) return true;
  return SOCIAL.test(new URL(address).hostname);
}

/** The schema.org Recipe the chat runner's model reads out of `text`. */
async function readCaption(text: string): Promise<Record<string, unknown>> {
  const response = await fetch("/chat/recipe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = response.headers.get("content-type")?.includes("json")
    ? ((await response.json()) as { recipe?: Record<string, unknown>; error?: string })
    : {};
  if (response.ok && body.recipe !== undefined) return body.recipe;
  throw new Error(body.error ?? `The model could not be asked (${response.status})`);
}

async function write(body: components["schemas"]["RecipeImport"]): Promise<ImportedNote> {
  const { data, error, response } = await client.POST("/api/recipes/import", { body });
  if (!data) {
    throw new Error(reason(error) ?? `POST /api/recipes/import failed with ${response.status}`);
  }
  return data;
}

/**
 * Writes the recipe in `text` as a note, by its link or through the model, and says where.
 * A link that fails while text sits beside it, such as a recipe pasted under a walled site's
 * link, has the model read the text; when that finds none, the link's own failure is said.
 */
export async function importRecipe(text: string): Promise<ImportedNote> {
  const address = firstAddress(text);
  if (needsReading(text)) return write({ recipe: await readCaption(text), source: address });
  try {
    return await write({ url: address });
  } catch (failed) {
    if (!(failed instanceof Error) || text.replace(address ?? "", "").trim() === "") throw failed;
    const recipe = await readCaption(text).catch((none: unknown) => {
      if (none instanceof Error) throw failed;
      throw none;
    });
    return write({ recipe, source: address });
  }
}
