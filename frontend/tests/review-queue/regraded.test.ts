import { writeSchedule } from "@/lib/review/card-write";
import type { Deck } from "@/lib/review/review";
import { cardsRead, regraded } from "@/lib/review/review-queue";
import type { Card, Schedule } from "@/lib/review/srs";

const DECK: Deck = {
  name: "aws",
  notes: ["decks/aws.md"],
  due: 0,
  fresh: 0,
  parked: 0,
  whole: false,
  next: null,
};

const NOTE = "decks/aws.md";

/** Every shape a grade writes to, each beside neighbours that a shift would move. */
const SHAPES: Record<string, string> = {
  inline: "#flashcards/aws\n\nA::one\n\nB::two <!--SR:!2026-08-20,4,270-->\n\nC::three\n",
  "question mark":
    "#flashcards/aws\n\nFront\n?\nBack\n\nNext\n?\nAfter\n<!--SR:!2026-08-20,4,270-->\n\nZ::z\n",
  "multi-line front and back": "#flashcards/aws\n\nOne\nTwo\n?\nThree\nFour\n\nAfter::x\n",
  "cloze on one line": "#flashcards/aws\n\nThe ==sky== is ==blue==.\n\nLast::x\n",
  "cloze with a comment":
    "#flashcards/aws\n\nThe ==sky== is ==blue==. <!--SR:c1!2026-08-20,4,270-->\n\nLast::x\n",
  "cloze under a question mark":
    "#flashcards/aws\n\nThe ==sky== is ==blue==.\n?\nExtra\n\nLast::x\n",
  "cloze under a question mark with comments":
    "#flashcards/aws\n\nThe ==sky== is ==blue==.\n?\nExtra\n<!--SR:c2!2026-08-20,4,270-->\n\nLast::x\n",
  "parked neighbour":
    "#flashcards/aws\n\nA::one\n\nB::two !suspended\n\nFront\n?\nBack\n!suspended\n\nC::three\n",
  "code and headings":
    "#flashcards/aws\n\n# Head\n\nFront\n?\nBack\n\n```\nnot::a card\n```\n\n## Two\n\nA::one\n",
  "own tags":
    "# Note\n\n#flashcards/aws A::one\n\n#flashcards/aws\nFront\n?\nBack\n\nB::two #flashcards/aws\n",
  "tag in a comment":
    "#flashcards/aws\n\nA::one\n\n<!-- #flashcards/other -->\nB::two\n\nC::three #flashcards/aws\n",
  "trailing spaces": "#flashcards/aws\n\nA::one   \n\nThe ==sky== is blue.  \n\nB::two\t\n",
  frontmatter:
    "---\ntags: [x]\nmodified: 2026-10-30\n---\n#flashcards/aws\n\nFront\n?\nBack\n\nA::one\n",
};

const MOVED: Schedule = { due: "2026-11-02", interval: 3, ease: 250 };

/**
 * Grades each card in turn off the shifted cards, so a later grade reads lines the shift moved,
 * and checks every shift against a parse. Returns the text and cards the last grade left.
 */
function gradeEach(text: string, held: Card[], moved: Schedule): [string, Card[]] {
  let current = text;
  let cards = held;
  for (let at = 0; at < cards.length; at++) {
    const card = cards[at];
    if (card === undefined || card.parked !== null) continue;
    const next = writeSchedule(current, card, moved);
    const shifted = regraded(DECK, cards, card, current, next);
    expect(shifted).toEqual(cardsRead(DECK, new Map([[NOTE, next]])).get(NOTE));
    current = next;
    cards = shifted ?? [];
  }
  return [current, cards];
}

describe("regraded shifts the cards to what a parse reads (#1379)", () => {
  for (const [shape, text] of Object.entries(SHAPES)) {
    it(`#1379 A3 grading each card of ${shape} shifts to the parse, on the first grade and every later one`, () => {
      const cards = cardsRead(DECK, new Map([[NOTE, text]])).get(NOTE) ?? [];
      expect(cards.length).toBeGreaterThan(0);
      const [once, graded] = gradeEach(text, cards, MOVED);
      // A second round regrades cards that already hold a schedule.
      gradeEach(once, graded, { ...MOVED, interval: 9 });
    });
  }

  it("#1379 I5 a whole-note deck is never shifted, its schedule being in the frontmatter", () => {
    const text = "# Whole\n\nBody\n";
    const deck = { ...DECK, whole: true };
    const cards = cardsRead(deck, new Map([[NOTE, text]])).get(NOTE) ?? [];
    expect(regraded(deck, cards, cards[0] as never, text, `---\nsr-due: x\n---\n${text}`)).toBe(
      undefined,
    );
  });
});
