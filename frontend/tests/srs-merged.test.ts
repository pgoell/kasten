import { setSuspended, writeSchedule } from "@/lib/card-write";
import { parseCards } from "@/lib/srs";
import { only } from "./srs-fixture";

describe("#678 two ? cards with no blank line between them are one card", () => {
  /** Two `?` cards with no blank line between them, neither answered yet. */
  const PAIR = "#flashcards/a\n\nq1\n?\na1\nq2\n?\na2\n";
  const held = { due: "2026-08-20", interval: 3, ease: 250 };
  const cards = (text: string) =>
    parseCards(text).map(({ from, to, front, back, held }) => ({ from, to, front, back, held }));

  it("#678 A1 two ? cards with no blank line read as one card, and a schedule between them still splits them", () => {
    expect({
      unscheduled: cards(PAIR),
      scheduled: cards("#flashcards/a\n\nq1\n?\na1\n<!--SR:!2026-08-20,3,250-->\nq2\n?\na2\n"),
      inline: cards("#flashcards/a\n\na::b <!--SR:!2026-08-20,3,250-->\nq\n?\nans\n"),
    }).toEqual({
      unscheduled: [{ from: 2, to: 7, front: "q1", back: "a1\nq2\n?\na2", held: null }],
      scheduled: [
        { from: 2, to: 5, front: "q1", back: "a1", held },
        { from: 6, to: 8, front: "q2", back: "a2", held: null },
      ],
      inline: [
        { from: 2, to: 2, front: "a", back: "b", held },
        { from: 3, to: 5, front: "q", back: "ans", held: null },
      ],
    });
  });

  it("#678 A2 a rating of the merged card writes one schedule under its last line and a second rating rewrites it", () => {
    const second = { due: "2026-08-24", interval: 3, ease: 250 };
    const once = writeSchedule(PAIR, only(PAIR), { due: "2026-08-21", interval: 1, ease: 250 });
    const twice = writeSchedule(once, only(once), second);

    expect({
      held: parseCards(twice).map((card) => card.held),
      schedules: twice.split("<!--SR:").length - 1,
      once,
      twice,
    }).toEqual({
      held: [second],
      schedules: 1,
      once: `${PAIR}<!--SR:!2026-08-21,1,250-->\n`,
      twice: `${PAIR}<!--SR:!2026-08-24,3,250-->\n`,
    });
  });

  it("#678 I1 parking and unparking the merged card gives the text back", () => {
    const on = setSuspended(PAIR, only(PAIR), true);
    const off = setSuspended(on, only(on), false);

    expect({ parked: parseCards(on).map((card) => card.parked), on, off }).toEqual({
      parked: ["suspended"],
      on: `${PAIR}!suspended\n`,
      off: PAIR,
    });
  });

  it("#678 I2 a ? cloze directly over a ? card is one card", () => {
    const text = "#flashcards/a\n\nThe capital of {{c1::France}} is Paris.\n?\nextra\nq2\n?\na2\n";
    const written = writeSchedule(text, only(text), { due: "2026-08-21", interval: 1, ease: 250 });

    expect({
      cards: parseCards(text).map(({ from, to, back, cloze }) => ({ from, to, back, cloze })),
      schedules: written.split("<!--SR:").length - 1,
      written,
    }).toEqual({
      cards: [
        {
          from: 2,
          to: 7,
          back: "The capital of ==France== is Paris.\n\nextra\nq2\n?\na2",
          cloze: 1,
        },
      ],
      schedules: 1,
      written: `${text}<!--SR:c1!2026-08-21,1,250-->\n`,
    });
  });

  it("#678 I5 three ? cards in a row with no blank line are one card", () => {
    const text = "#flashcards/a\n\nq1\n?\na1\nq2\n?\na2\nq3\n?\na3\n";
    const written = writeSchedule(text, only(text), { due: "2026-08-21", interval: 1, ease: 250 });

    expect({ cards: cards(text), written }).toEqual({
      cards: [{ from: 2, to: 10, front: "q1", back: "a1\nq2\n?\na2\nq3\n?\na3", held: null }],
      written: `${text}<!--SR:!2026-08-21,1,250-->\n`,
    });
  });

  it("#678 I6 a schedule under the lower card belongs to the one card and a rating rewrites it", () => {
    const text = `${PAIR}<!--SR:!2026-08-20,3,250-->\n`;
    const written = writeSchedule(text, only(text), { due: "2026-08-24", interval: 4, ease: 250 });

    expect({ cards: cards(text), written }).toEqual({
      cards: [{ from: 2, to: 8, front: "q1", back: "a1\nq2\n?\na2", held }],
      written: `${PAIR}<!--SR:!2026-08-24,4,250-->\n`,
    });
  });
});

describe("#683 an unscheduled one-line card over a ? card's question is a card of its own", () => {
  const cards = (text: string) =>
    parseCards(text).map(({ from, to, front, back, inline }) => ({
      from,
      to,
      front,
      back,
      inline,
    }));

  it("#683 A2 a one-line card with no schedule over a ? card reads as two cards", () => {
    expect(cards("#flashcards/a\n\na::b\nq\n?\nans\n")).toEqual([
      { from: 2, to: 2, front: "a", back: "b", inline: true },
      { from: 3, to: 5, front: "q", back: "ans", inline: false },
    ]);
  });

  it("#683 I4 a front over two lines stops at the one-line card over it", () => {
    expect(cards("#flashcards/a\n\na::b\nq1\nq2\n?\nans\n")).toEqual([
      { from: 2, to: 2, front: "a", back: "b", inline: true },
      { from: 3, to: 6, front: "q1\nq2", back: "ans", inline: false },
    ]);
  });

  it("#683 I5 a one-line card directly over a ? is its own card and the ? under it is none", () => {
    expect(cards("#flashcards/a\n\na::b\n?\nans\n")).toEqual([
      { from: 2, to: 2, front: "a", back: "b", inline: true },
    ]);
  });

  it("#683 I6 a rating of either card writes its own schedule and leaves the other's lines", () => {
    const text = "#flashcards/a\n\na::b\nq\n?\nans\n";
    const next = { due: "2026-08-21", interval: 1, ease: 250 };
    const [first, second] = parseCards(text);

    expect({
      inline: [first?.inline, second?.inline],
      first: first && writeSchedule(text, first, next),
      second: second && writeSchedule(text, second, next),
    }).toEqual({
      inline: [true, false],
      first: "#flashcards/a\n\na::b <!--SR:!2026-08-21,1,250-->\nq\n?\nans\n",
      second: "#flashcards/a\n\na::b\nq\n?\nans\n<!--SR:!2026-08-21,1,250-->\n",
    });
  });

  it("#683 I7 a divider in a code span or at the head of a line is no card and stays in the front", () => {
    expect({
      span: cards("#flashcards/a\n\n`a::b`\nq\n?\nans\n"),
      head: cards("#flashcards/a\n\n::b\nq\n?\nans\n"),
    }).toEqual({
      span: [{ from: 2, to: 5, front: "`a::b`\nq", back: "ans", inline: false }],
      head: [{ from: 2, to: 5, front: "::b\nq", back: "ans", inline: false }],
    });
  });
});
