import { setSuspended } from "@/lib/card-write";
import { decksFrom } from "@/lib/review";
import { parseCards } from "@/lib/srs";
import { one, TODAY } from "./review-fixture";

/** What the sitting would count off the same note, by `parseCards`. */
function sat(text: string) {
  const cards = parseCards(text, "n").filter((card) => card.decks.length > 0);
  return {
    due: cards.filter((card) => !card.parked && card.held !== null && card.held.due <= TODAY)
      .length,
    fresh: cards.filter((card) => !card.parked && card.held === null).length,
    parked: cards.filter((card) => card.parked !== null).length,
  };
}

describe("decksFrom on a cloze", () => {
  it("counts each number of a one-line cloze as a card, new or due off its own comment", () => {
    const text =
      "#flashcards/geo\n\nThe capital of {{c1::France}} is {{c2::Paris}}. <!--SR:c2!2026-08-01,1,250-->\n";
    const counted = { due: 1, fresh: 1, parked: 0 };

    expect(decksFrom(one("g.md", text), TODAY)).toMatchObject([{ name: "geo", ...counted }]);
    expect(sat(text)).toEqual(counted);
  });

  it("agrees with the sitting on a `?` cloze, its comments under the back", () => {
    const text =
      "#flashcards/geo\n\nThe capital of {{c1::France}} is {{c2::Paris}}.\n?\nOn the Seine.\n" +
      "<!--SR:c1!2026-08-01,1,250--> <!--SR:c2!2026-09-01,1,250-->\n\nc {{c1::d}} c::e\n";
    const counted = { due: 1, fresh: 1, parked: 0 };

    expect(decksFrom(one("g.md", text), TODAY)).toMatchObject([{ name: "geo", ...counted }]);
    expect(sat(text)).toEqual(counted);
  });

  it("agrees on a `?` cloze whose front holds a marked line further up", () => {
    const text = "#flashcards\n\n{{c1::a}} first\n{{c1::b}} {{c2::c}}\n?\nextra\n!suspended\n";
    const counted = { due: 0, fresh: 1, parked: 2 };

    expect(decksFrom(one("n.md", text), TODAY)).toMatchObject([counted]);
    expect(sat(text)).toEqual(counted);
  });

  it("agrees on a cloze over a `?` with nothing under it", () => {
    // The `?` is the cloze's, its back empty, its dates on the line under it.
    for (const text of [
      "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c1!2026-08-01,1,250-->\n?\n\nprose\n",
      "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\n<!--SR:c1!2026-08-01,1,250-->\n",
    ]) {
      const counted = text.includes("}}\n?\n<!--") ? { due: 1, fresh: 1 } : { due: 0, fresh: 2 };

      expect(decksFrom(one("n.md", text), TODAY)).toMatchObject([counted]);
      expect(sat(text)).toMatchObject(counted);
    }
  });

  it("agrees on a `?` cloze parked under a plain comment", () => {
    const text = "#flashcards\nThe {{c1::A}} b\n?\nback\n<!--SR:!2026-10-01,1,250-->";
    const [card] = parseCards(text);
    if (card === undefined) throw new Error("no card");
    // Parked the way the session parks it, then read by both.
    const parked = setSuspended(text, card, true);
    const counted = { due: 0, fresh: 0, parked: 1 };

    expect(decksFrom(one("n.md", parked), TODAY)).toMatchObject([counted]);
    expect(sat(parked)).toEqual(counted);
  });

  it("counts every number parked off one token, on the line or under the back", () => {
    const text =
      "#flashcards\n\n{{c1::a}} {{c2::b}} !suspended\n\n{{c1::c}} {{c2::d}}\n?\nextra\n" +
      "!suspended <!--SR:c1!2026-08-01,1,250-->\n";
    const counted = { due: 0, fresh: 0, parked: 4 };

    expect(decksFrom(one("n.md", text), TODAY)).toMatchObject([counted]);
    expect(sat(text)).toEqual(counted);
  });

  it("counts a cloze line under a `?` back as part of that back", () => {
    const text = "#flashcards\n\nQ\n?\nA\n{{c1::x}} y\n";
    expect(decksFrom(one("n.md", text), TODAY)).toMatchObject([{ fresh: 1 }]);
    expect(sat(text)).toEqual({ due: 0, fresh: 1, parked: 0 });
  });

  it("counts a `::` line under a `?` back as part of that back", () => {
    const text = "#flashcards\n\nQ\n?\nA\na::b\n";
    expect(decksFrom(one("n.md", text), TODAY)).toMatchObject([{ fresh: 1 }]);
    expect(sat(text)).toEqual({ due: 0, fresh: 1, parked: 0 });
  });

  it("counts no cloze inside a fence, and none in a note nobody tagged", () => {
    const fenced = "#flashcards\n\na::b\n\n```\n{{c1::a}} {{c2::b}}\n```\n";
    expect(decksFrom(one("f.md", fenced), TODAY)).toMatchObject([{ fresh: 1 }]);
    expect(sat(fenced)).toEqual({ due: 0, fresh: 1, parked: 0 });

    const untagged = "prose\n\n{{c1::a}} {{c2::b}}\n";
    expect(decksFrom(one("u.md", untagged), TODAY)).toEqual([]);
    expect(sat(untagged)).toEqual({ due: 0, fresh: 0, parked: 0 });
    // Still two cards, only in no deck: the sitting drops them as the overview does.
    expect(parseCards(untagged)).toHaveLength(2);
  });
});
