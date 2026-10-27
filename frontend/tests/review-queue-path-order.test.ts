import { type DeckNote, decksFrom } from "@/lib/review/review";
import { seatsFor } from "@/lib/review/review-queue";
import { TODAY } from "./review-fixture";

const NO_LIMITS = { note: null, defaults: { new_per_day: null, reviews_per_day: null } };
/** Due before today, and never answered today. */
const DUE = "<!--SR:!2026-08-10,3,250-->";

/** One note of the split deck, holding two cards that carry `schedule` each. */
function part(number: string, schedule: string): DeckNote {
  return {
    path: `deck ${number}.md`,
    text: [
      "#flashcards/split",
      `${number} first::a${schedule}`,
      `${number} second::a${schedule}`,
    ].join("\n"),
  };
}

/** The seats of the split deck, read off notes handed over in the order given. */
function seatsOf(notes: DeckNote[]) {
  const deck = decksFrom(notes, TODAY, NO_LIMITS).find((each) => each.name === "split");
  if (deck === undefined) throw new Error("no split deck");
  const texts = new Map(notes.map(({ path, text }) => [path, text]));
  return seatsFor(deck, texts, TODAY, NO_LIMITS).map(({ note, at }) => [note, at]);
}

describe("seatsFor on a deck spread over several notes", () => {
  it("#1136 A8 seatsFor asks a split deck's new cards in path order, whatever order the notes come in", () => {
    expect(seatsOf([part("03", ""), part("01", ""), part("02", "")])).toEqual([
      ["deck 01.md", 0],
      ["deck 01.md", 1],
      ["deck 02.md", 0],
      ["deck 02.md", 1],
      ["deck 03.md", 0],
      ["deck 03.md", 1],
    ]);
  });

  it("#1136 I5 seatsFor asks a split deck's due cards in path order too", () => {
    expect(seatsOf([part("03", ` ${DUE}`), part("01", ` ${DUE}`), part("02", ` ${DUE}`)])).toEqual([
      ["deck 01.md", 0],
      ["deck 01.md", 1],
      ["deck 02.md", 0],
      ["deck 02.md", 1],
      ["deck 03.md", 0],
      ["deck 03.md", 1],
    ]);
  });
});
