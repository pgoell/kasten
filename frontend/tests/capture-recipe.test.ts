import { importRecipe, needsReading } from "@/lib/capture/recipe";
import { client } from "@/lib/core/api-client";

/** A shared recipe into a note (#1725): a recipe link goes to kasten, a caption to the model first. */

const CHEFKOCH = "https://www.chefkoch.de/rezepte/1170311223132029/Chili-sin-Carne.html";
const REEL = "https://www.instagram.com/reel/C0abc/";
const CAPTION = `Feta-Pasta 🍅 Für 2: 200 g Feta, 400 g Kirschtomaten. 25 Min backen.\n${REEL}`;
const RECIPE = {
  name: "Feta-Pasta",
  recipeIngredient: ["200 g Feta"],
  recipeInstructions: ["Backen."],
};
const NOTE = { path: "Rezepte/Feta-Pasta.md", title: "Feta-Pasta" };

function imported(answer: object, status = 201) {
  return vi.spyOn(client, "POST").mockResolvedValue({
    data: status === 201 ? answer : undefined,
    error: status === 201 ? undefined : answer,
    response: new Response(null, { status }),
  } as never);
}

function runner(status: number, body: object) {
  const sent = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", sent);
  return sent;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("importing a shared recipe", () => {
  it("tells a recipe page from a caption", () => {
    expect(needsReading(`Chili sin Carne | Chefkoch\n${CHEFKOCH}`)).toBe(false);
    expect(needsReading(CAPTION)).toBe(true);
    expect(needsReading("https://youtu.be/abc")).toBe(true);
    expect(needsReading("200 g Feta, backen")).toBe(true);
  });

  it("sends a recipe link to kasten to read", async () => {
    const post = imported({ path: "Rezepte/Chili sin Carne.md", title: "Chili sin Carne" });
    const sent = runner(200, {});
    expect((await importRecipe(CHEFKOCH)).path).toBe("Rezepte/Chili sin Carne.md");
    expect(post).toHaveBeenCalledWith("/api/recipes/import", { body: { url: CHEFKOCH } });
    expect(sent).not.toHaveBeenCalled();
  });

  it("has the model read a caption, then imports its recipe with the reel as source", async () => {
    const sent = runner(200, { recipe: RECIPE });
    const post = imported(NOTE);
    expect(await importRecipe(CAPTION)).toEqual(NOTE);
    expect(sent.mock.calls[0]?.[0]).toBe("/chat/recipe");
    expect(JSON.parse(String(sent.mock.calls[0]?.[1].body))).toEqual({ text: CAPTION });
    expect(post).toHaveBeenCalledWith("/api/recipes/import", {
      body: { recipe: RECIPE, source: REEL },
    });
  });

  it("says why when the model finds no recipe, and writes nothing", async () => {
    runner(422, { error: "No recipe in that text" });
    const post = imported(NOTE);
    await expect(importRecipe("Guten Morgen")).rejects.toThrow("No recipe in that text");
    expect(post).not.toHaveBeenCalled();
  });

  it("has the model read a recipe pasted under a link the site turned away", async () => {
    const wall = { detail: "The site turned the fetch away (403); paste the recipe" };
    const post = vi
      .spyOn(client, "POST")
      .mockResolvedValueOnce({
        data: undefined,
        error: wall,
        response: new Response(null, { status: 502 }),
      } as never)
      .mockResolvedValueOnce({ data: NOTE, error: undefined, response: new Response() } as never);
    const sent = runner(200, { recipe: RECIPE });
    const pasted = `https://www.hellofresh.de/recipes/x\n200 g Feta, backen`;
    expect(await importRecipe(pasted)).toEqual(NOTE);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenLastCalledWith("/api/recipes/import", {
      body: { recipe: RECIPE, source: "https://www.hellofresh.de/recipes/x" },
    });
  });

  it("says the link's failure when the text beside it holds no recipe", async () => {
    imported({ detail: "The site turned the fetch away (403); paste the recipe" }, 502);
    runner(422, { error: "No recipe in that text" });
    await expect(importRecipe(`Lecker!\n${CHEFKOCH}`)).rejects.toThrow("paste the recipe");
  });

  it("passes on kasten's reason when the import is refused", async () => {
    imported({ detail: "The site turned the fetch away (403); paste the recipe" }, 502);
    await expect(importRecipe(CHEFKOCH)).rejects.toThrow("paste the recipe");
  });
});
