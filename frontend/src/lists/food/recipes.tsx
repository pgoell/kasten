/**
 * The Rezepte tab: the vault's recipe notes as `GET /share/recipes` lists them, and one opened to
 * cook from, its amounts scaled to the servings asked. Read-only; recipes are written in kasten.
 */

import { useEffect, useState } from "react";

export type SharedRecipeEntry = {
  name: string;
  title: string;
  servings: number | null;
  time: string | null;
  tags: string[];
};
export type SharedIngredient = {
  text: string;
  group: string | null;
  quantity: number | null;
  quantity_to: number | null;
  rest: string;
};
export type SharedRecipe = SharedRecipeEntry & {
  source: string | null;
  ingredients: SharedIngredient[];
  steps: string[];
};

/** A number as the recipe card writes it: at most two decimals, a comma, no trailing zeros. */
function shown(value: number): string {
  return String(Number(value.toFixed(2))).replace(".", ",");
}

/** The line as written at the note's own servings; otherwise its quantity times `factor`. */
export function scaledLine(item: SharedIngredient, factor: number): string {
  if (factor === 1 || item.quantity === null) return item.text;
  const upper = item.quantity_to === null ? "" : `-${shown(item.quantity_to * factor)}`;
  return `${shown(item.quantity * factor)}${upper} ${item.rest}`.trim();
}

/** `4 Portionen · 45 min`, the facts a recipe's frontmatter gives, or "" for none. */
export function recipeFacts(recipe: SharedRecipeEntry): string {
  const servings =
    recipe.servings === null
      ? []
      : [`${shown(recipe.servings)} ${recipe.servings === 1 ? "Portion" : "Portionen"}`];
  return [...servings, ...(recipe.time ? [recipe.time] : [])].join(" · ");
}

/** The recipes whose title or a tag holds every word of `query`, ignoring case. */
export function matching(recipes: SharedRecipeEntry[], query: string): SharedRecipeEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return recipes.filter((recipe) => {
    const said = [recipe.title, ...recipe.tags].join(" ").toLowerCase();
    return words.every((word) => said.includes(word));
  });
}

/** The ingredient lines in runs of one group each, in the note's order. */
function grouped(lines: SharedIngredient[]): { group: string | null; lines: SharedIngredient[] }[] {
  const runs: { group: string | null; lines: SharedIngredient[] }[] = [];
  for (const line of lines) {
    const last = runs.at(-1);
    if (last && last.group === line.group) last.lines.push(line);
    else runs.push({ group: line.group, lines: [line] });
  }
  return runs;
}

/** GET a share route's JSON, or null for a 404; anything else not ok says it failed. */
async function read<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: "no-store", redirect: "manual" });
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(`Rezepte konnten nicht geladen werden (${res.status || "Anmelden"})`);
  return (await res.json()) as T;
}

/** `url` read once each time it changes: the answer, null for none, or the failure's words. */
function useRead<T>(url: string): { data: T | null | undefined; failed: string | null } {
  const [data, setData] = useState<T | null | undefined>(undefined);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(undefined);
    setFailed(null);
    read<T>(url).then(
      (answer) => {
        if (live) setData(answer);
      },
      (error: unknown) => {
        if (!(error instanceof Error)) throw error;
        if (live) setFailed(error.message);
      },
    );
    return () => {
      live = false;
    };
  }, [url]);
  return { data, failed };
}

type RecipesProps = {
  open: string | null;
  onOpen: (name: string) => void;
  onBack: () => void;
};

/** The tab, read only while it is the one `shown`: the list, or the recipe `open` names. */
export function RecipesTab({ shown, ...props }: RecipesProps & { shown: boolean }) {
  if (!shown) return null;
  return props.open === null ? (
    <RecipeList onOpen={props.onOpen} />
  ) : (
    <Recipe key={props.open} name={props.open} onBack={props.onBack} />
  );
}

function RecipeList({ onOpen }: { onOpen: (name: string) => void }) {
  const { data, failed } = useRead<SharedRecipeEntry[]>("/share/recipes");
  const [query, setQuery] = useState("");
  const found = matching(data ?? [], query);
  return (
    <main className="lists recipes">
      <input
        className="field recipe-search"
        type="search"
        aria-label="Rezept suchen"
        placeholder="Rezept suchen"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {failed !== null && <p className="empty">{failed}</p>}
      {data?.length === 0 && <p className="empty">Noch keine Rezepte</p>}
      {data && data.length > 0 && found.length === 0 && <p className="empty">Kein Rezept passt</p>}
      {found.length > 0 && (
        <div className="group meal-group">
          {found.map((recipe) => (
            <button
              key={recipe.name}
              type="button"
              className="meal recipe-entry"
              onClick={() => onOpen(recipe.name)}
            >
              <span className="meal-dish">{recipe.title}</span>
              <span className="meal-slot recipe-facts">{recipeFacts(recipe)}</span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

function Recipe({ name, onBack }: { name: string; onBack: () => void }) {
  const { data, failed } = useRead<SharedRecipe>(`/share/recipes/${encodeURIComponent(name)}`);
  const [servings, setServings] = useState<number | null>(null);
  const base = data?.servings ?? null;
  const wanted = servings ?? base;
  const factor = base !== null && wanted !== null ? wanted / base : 1;
  return (
    <main className="lists recipe">
      <button type="button" className="recipe-back" onClick={onBack}>
        Alle Rezepte
      </button>
      {failed !== null && <p className="empty">{failed}</p>}
      {data === null && <p className="empty">Dieses Rezept gibt es nicht mehr</p>}
      {data && (
        <article aria-label={data.title}>
          <h2 className="recipe-title">{data.title}</h2>
          {data.time && <p className="recipe-meta">{data.time}</p>}
          {wanted !== null && (
            // biome-ignore lint/a11y/useSemanticElements: a stepper of two buttons, not a form group
            <div className="recipe-servings" role="group" aria-label="Portionen">
              <button
                type="button"
                aria-label="Weniger"
                disabled={wanted <= 1}
                onClick={() => setServings(Math.max(1, Math.ceil(wanted) - 1))}
              >
                −
              </button>
              <span>
                {shown(wanted)} {wanted === 1 ? "Portion" : "Portionen"}
              </span>
              <button
                type="button"
                aria-label="Mehr"
                onClick={() => setServings(Math.floor(wanted) + 1)}
              >
                +
              </button>
            </div>
          )}
          {grouped(data.ingredients).map((run, n) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a read-only recipe's parts are their places.
            <section key={n} aria-label={run.group ?? "Zutaten"}>
              <div className="group-head">
                <h2>{run.group ?? "Zutaten"}</h2>
              </div>
              <ul className="recipe-lines">
                {run.lines.map((line, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a line is its place in the note.
                  <li key={at}>{scaledLine(line, factor)}</li>
                ))}
              </ul>
            </section>
          ))}
          {data.steps.length > 0 && (
            <section aria-label="Schritte">
              <div className="group-head">
                <h2>Schritte</h2>
              </div>
              <ol className="recipe-steps">
                {data.steps.map((step, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a step is its place in the note.
                  <li key={at}>{step}</li>
                ))}
              </ol>
            </section>
          )}
          {data.source?.startsWith("http") && (
            <a className="recipe-source" href={data.source} target="_blank" rel="noreferrer">
              Quelle
            </a>
          )}
        </article>
      )}
      <p className="meals-foot">Nur zum Lesen. Geschrieben wird in kasten.</p>
    </main>
  );
}
