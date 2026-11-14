import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { cookChip, dayLabel, mealWords, type SharedDay } from "@/lists/food/meals";
import {
  matching,
  recipeFacts,
  type SharedRecipe,
  type SharedRecipeEntry,
  scaledLine,
} from "@/lists/food/recipes";
import { ListsApp } from "@/lists/lists-app";
import { fakeShare } from "./lists-fixture";

/** The Essen tab (#1727) and the Rezepte tab: meals and recipes, read-only, in the lists app. */

const today = (() => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
})();

const WEEK: SharedDay[] = [
  {
    date: today,
    meals: [
      {
        slot: "lunch",
        kind: "from",
        dish: "Chili sin carne",
        servings: null,
        cook: null,
        recipe: "Chili",
      },
      {
        slot: "dinner",
        kind: "cook",
        dish: "Linsen-Dal",
        servings: 4,
        cook: "Pascal",
        recipe: null,
      },
    ],
  },
  {
    date: "2099-01-02",
    meals: [
      {
        slot: "dinner",
        kind: "cook",
        dish: "Hähnchen-Bowls",
        servings: 5,
        cook: "Alicia",
        recipe: null,
      },
    ],
  },
];

const BOOK: SharedRecipeEntry[] = [
  { name: "Chili", title: "Chili sin carne", servings: 4, time: "45 min", tags: ["prep"] },
  { name: "Dal", title: "Linsen-Dal", servings: null, time: null, tags: ["vegetarisch"] },
];

const CHILI: SharedRecipe = {
  ...(BOOK[0] as SharedRecipeEntry),
  source: "https://example.org/chili",
  ingredients: [
    { text: "500 g Bohnen", group: null, quantity: 500, quantity_to: null, rest: "g Bohnen" },
    { text: "2-3 Zwiebeln", group: null, quantity: 2, quantity_to: 3, rest: "Zwiebeln" },
    { text: "Salz", group: null, quantity: null, quantity_to: null, rest: "Salz" },
    {
      text: "150 g Schmand",
      group: "Zum Servieren",
      quantity: 150,
      quantity_to: null,
      rest: "g Schmand",
    },
  ],
  steps: ["Zwiebeln würfeln.", "Alles köcheln."],
};

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

/** The fake `/share` with `/share/meals` answering `answer()`, read again on each request. */
function open(answer: () => SharedDay[]) {
  const share = fakeShare({ Einkauf: [], Todo: [] });
  const asked: string[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/share/recipes") return json(BOOK);
    if (url === "/share/recipes/Chili") return json(CHILI);
    if (url.startsWith("/share/recipes/")) return json({ detail: "No such recipe" }, 404);
    if (!url.startsWith("/share/meals")) return share.fetch(url, init);
    asked.push(url);
    return json(answer());
  });
  render(<ListsApp />);
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("the Essen tab's words", () => {
  it("names today in full and the other days short", () => {
    expect(dayLabel("2026-11-09", "2026-11-09")).toBe("Heute · Mo 9. Nov");
    expect(dayLabel("2026-11-10", "2026-11-09")).toBe("Di 10.");
  });

  it("says ×N for a batch, Rest for a meal from one, and Ich for the viewer's own cooking", () => {
    const [rest, cook] = WEEK[0]?.meals ?? [];
    if (rest === undefined || cook === undefined) throw new Error("no meals");
    expect(mealWords(rest)).toEqual({ dish: "Chili sin carne", rest: true });
    expect(mealWords(cook)).toEqual({ dish: "Linsen-Dal ×4", rest: false });
    expect(cookChip(cook, "Pascal")).toBe("Ich");
    expect(cookChip(cook, "Alicia")).toBe("Pascal");
    expect(cookChip(rest, "Pascal")).toBeNull();
  });
});

describe("the Essen tab", () => {
  it("comes third, shows the days with their meals, and hides the entry", async () => {
    const asked = open(() => WEEK);
    const tabs = await screen.findByRole("group", { name: "Liste" });
    const names = within(tabs)
      .getAllByRole("button")
      .map((tab) => tab.textContent?.split(" ")[0]);
    expect(names).toEqual(["Einkauf", "Todo", "Essen", "Rezepte"]);

    fireEvent.click(within(tabs).getByRole("button", { name: "Essen" }));

    const day = await screen.findByRole("region", { name: dayLabel(today, today) });
    expect(within(day).getByText("Mittag")).toBeInTheDocument();
    expect(within(day).getByText("· Rest")).toBeInTheDocument();
    expect(within(day).getByText("Linsen-Dal ×4")).toBeInTheDocument();
    expect(within(day).getByText("Ich")).toBeInTheDocument();
    expect(screen.getByText("Alicia")).toBeInTheDocument();
    expect(screen.getByText("Nur zum Lesen. Geplant wird in kasten.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Eintrag" })).toBeNull();
    expect(asked[0]).toBe(`/share/meals?today=${today}`);
  });

  it("reads the meals again when the page comes back", async () => {
    let week: SharedDay[] = [];
    open(() => week);
    fireEvent.click(await screen.findByRole("button", { name: "Essen" }));
    expect(await screen.findByText("Noch nichts geplant")).toBeInTheDocument();

    week = WEEK;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText("Linsen-Dal ×4")).toBeInTheDocument();
  });
});

describe("the Rezepte tab's words", () => {
  it("scales a quantity and a range, and keeps a line with no amount as written", () => {
    const [beans, onions, salt] = CHILI.ingredients;
    if (!beans || !onions || !salt) throw new Error("no lines");
    expect(scaledLine(beans, 1)).toBe("500 g Bohnen");
    expect(scaledLine(beans, 0.5)).toBe("250 g Bohnen");
    expect(scaledLine(onions, 1.5)).toBe("3-4,5 Zwiebeln");
    expect(scaledLine(salt, 2)).toBe("Salz");
  });

  it("says the servings and time, and finds a recipe by its title or a tag", () => {
    expect(BOOK.map(recipeFacts)).toEqual(["4 Portionen · 45 min", ""]);
    expect(matching(BOOK, "dal").map((recipe) => recipe.name)).toEqual(["Dal"]);
    expect(matching(BOOK, "PREP").map((recipe) => recipe.name)).toEqual(["Chili"]);
    expect(matching(BOOK, "")).toHaveLength(2);
  });
});

describe("the Rezepte tab", () => {
  it("lists the recipes, opens one with its groups and steps, and scales it", async () => {
    open(() => WEEK);
    fireEvent.click(await screen.findByRole("button", { name: "Rezepte" }));
    fireEvent.click(await screen.findByRole("button", { name: /Chili sin carne/ }));

    const recipe = await screen.findByRole("article", { name: "Chili sin carne" });
    expect(within(recipe).getByText("2-3 Zwiebeln")).toBeInTheDocument();
    const serving = within(recipe).getByRole("region", { name: "Zum Servieren" });
    expect(within(serving).getByText("150 g Schmand")).toBeInTheDocument();
    expect(within(recipe).getByText("Alles köcheln.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Eintrag" })).toBeNull();

    fireEvent.click(within(recipe).getByRole("button", { name: "Mehr" }));
    expect(within(recipe).getByText("5 Portionen")).toBeInTheDocument();
    expect(within(recipe).getByText("625 g Bohnen")).toBeInTheDocument();
  });

  it("opens a planned dish's recipe from Essen, and back returns to Essen", async () => {
    open(() => WEEK);
    fireEvent.click(await screen.findByRole("button", { name: "Essen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Chili sin carne" }));

    expect(await screen.findByRole("article", { name: "Chili sin carne" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rezepte" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Alle Rezepte" }));
    expect(await screen.findByText("Linsen-Dal ×4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Essen" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says so when the recipe is gone", async () => {
    open(() => WEEK);
    fireEvent.click(await screen.findByRole("button", { name: "Rezepte" }));
    expect(await screen.findByRole("button", { name: /Linsen-Dal/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Linsen-Dal/ }));
    expect(await screen.findByText("Dieses Rezept gibt es nicht mehr")).toBeInTheDocument();
  });
});
