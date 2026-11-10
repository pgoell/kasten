import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ListsApp } from "@/lists/lists-app";
import { cookChip, dayLabel, mealWords, type SharedDay } from "@/lists/lists-meals";
import { fakeShare } from "./lists-fixture";

/** The Essen tab (#1727): the week plans' meals from today on, read-only, in the lists app. */

const today = (() => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
})();

const WEEK: SharedDay[] = [
  {
    date: today,
    meals: [
      { slot: "lunch", kind: "from", dish: "Chili sin carne", servings: null, cook: null },
      { slot: "dinner", kind: "cook", dish: "Linsen-Dal", servings: 4, cook: "Pascal" },
    ],
  },
  {
    date: "2099-01-02",
    meals: [{ slot: "dinner", kind: "cook", dish: "Hähnchen-Bowls", servings: 5, cook: "Alicia" }],
  },
];

/** The fake `/share` with `/share/meals` answering `answer()`, read again on each request. */
function open(answer: () => SharedDay[]) {
  const share = fakeShare({ Einkauf: [], Todo: [] });
  const asked: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("/share/meals")) return share.fetch(input, init);
    asked.push(url);
    return Promise.resolve(
      new Response(JSON.stringify(answer()), { headers: { "Content-Type": "application/json" } }),
    );
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
    expect(names).toEqual(["Einkauf", "Todo", "Essen"]);

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
