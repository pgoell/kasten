// @vitest-environment node
import { setSuspended, writeSchedule } from "@/lib/review/card-write";
import { type Card, parseCards } from "@/lib/review/srs";
import { only } from "./fixture";

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

describe("#1590 parking reads the token where the reader does", () => {
  const SCHEDULE = "<!--SR:!2026-08-20,4,270-->";
  const round = (line: string) => {
    const text = `#flashcards/x\n\n${line}\n`;
    const on = setSuspended(text, only(text), true);
    const off = setSuspended(on, only(on), false);
    return { before: only(text).parked, on: only(on).parked, off, after: only(off).parked };
  };

  it("#1590 parking and unparking a line with a commented token gives the line back", () => {
    const text = "#flashcards/x\n\nq::a <!-- !suspended -->\n";
    expect(round("q::a <!-- !suspended -->")).toEqual({
      before: null,
      on: "suspended",
      off: text,
      after: null,
    });
  });

  it("#1590 unparking takes the real token and keeps the comment's", () => {
    const text = "#flashcards/x\n\nq::a <!-- !suspended --> !suspended\n";
    const off = setSuspended(text, only(text), false);
    expect(off).toBe("#flashcards/x\n\nq::a <!-- !suspended -->\n");
  });

  it("#1590 parking a line that ends in a comment running on writes the token before it", () => {
    const text = "#flashcards/x\n\nq::a <!-- note\nmore -->\n";
    const on = setSuspended(text, only(text), true);
    const off = setSuspended(on, only(on), false);
    expect({ on, parked: only(on).parked, off }).toEqual({
      on: "#flashcards/x\n\nq::a !suspended <!-- note\nmore -->\n",
      parked: "suspended",
      off: text,
    });
  });

  it("#1590 reader and writer agree on generated lines with comments", () => {
    const heads = ["q::a", "{{c1::a}}", "{{c1::a}} {{c2::b}}"];
    const comments = ["<!-- !suspended -->", "<!--!suspended-->", "<!-- x !suspended y -->", ""];
    const tails = ["", SCHEDULE, "<!--SR:c1!2026-08-20,4,270-->", "`!suspended`"];
    const lines = heads.flatMap((head) =>
      comments.flatMap((comment) =>
        tails.flatMap((tail) => [`${head} ${comment} ${tail}`, `${head} ${tail} ${comment}`]),
      ),
    );
    for (const line of lines.map((line) => line.replace(/ +/g, " ").trim())) {
      expect({ line, ...round(line) }).toEqual({
        line,
        before: null,
        on: "suspended",
        off: `#flashcards/x\n\n${line}\n`,
        after: null,
      });
    }
  });
});

describe("#1929 a card with the plugin's !fsrs comment is left alone until FSRS lands", () => {
  const F = "<!--SR:!fsrs,2026-11-20T00:00:00.000Z,8,8.30,1.00,2,1,0,0,2026-11-12T00:00:00.000Z-->";
  const CF = F.replace("SR:!", "SR:c1!");
  const S = "<!--SR:!2026-08-20,4,270-->";
  const note = (body: string) => `#flashcards/x\n\n${body}\n\nn::m\n`;
  const read = (body: string) =>
    parseCards(note(body)).map((card) => [card.front, card.held?.due ?? null]);
  const N = ["n", null];

  it.each([
    ["an SM-2 comment", `q::a ${S}`, [["q", "2026-08-20"], N]],
    ["no comment", "q::a", [["q", null], N]],
    ["an !fsrs comment", `q::a ${F}`, [N]],
    ["!fsrs then SM-2", `q::a ${F} ${S}`, [N]],
    ["SM-2 then !fsrs", `q::a ${S} ${F}`, [N]],
    ["an escaped !fsrs comment", `q::a ${F.replace("SR:", "SR\\:")}`, [["q", null], N]],
    ["a ? card under SM-2", `q\n?\na\n${S}`, [["q", "2026-08-20"], N]],
    ["a ? card under !fsrs", `q\n?\na::b\n${F}`, [N]],
    ["a ? card under SM-2 then !fsrs", `q\n?\na::b\n${S}\n${F}`, [N]],
    ["a ? card under !fsrs then SM-2", `q\n?\na::b\n${F}\n${S}`, [N]],
    ["a parked ? card under !fsrs", `q\n?\na\n!suspended ${F}`, [N]],
    // The fence runs to the end, so it takes the card under it too.
    ["a ? card under !fsrs in an unclosed fence", `q\n?\na\n\`\`\`\n${F}`, []],
    ["a cloze with c1!fsrs", `{{c1::a}} {{c2::b}} ${CF}`, [N]],
    ["a ? cloze under c1!fsrs", `{{c1::a}}\n?\nextra\n${CF}`, [N]],
  ])("#1929 the reader on %s", (_, body, cards) => {
    expect(read(body)).toEqual(cards);
  });

  it("#1929 a left-alone card keeps the tags at its head off the other cards", () => {
    const decks = (body: string) => parseCards(note(body)).at(-1)?.decks;
    expect(decks(`#flashcards/y q::a ${F}`)).toEqual(decks(`#flashcards/y q::a ${S}`));
  });

  const NEXT = { due: "2026-09-01", interval: 9, ease: 250 };
  const W = "<!--SR:!2026-09-01,9,250-->";
  const at = (to: number, inline: boolean, cloze: number | null = null) =>
    ({ from: 2, to, inline, cloze }) as Card;

  it.each([
    ["no comment", "q::a", at(2, true), `q::a ${W}`],
    ["an SM-2 comment", `q::a ${S}`, at(2, true), `q::a ${W}`],
    ["an !fsrs comment", `q::a ${F}`, at(2, true), null],
    ["!fsrs then SM-2", `q::a ${F} ${S}`, at(2, true), null],
    ["SM-2 then !fsrs", `q::a ${S} ${F}`, at(2, true), null],
    ["a ? card with none", "q\n?\na", at(4, false), `q\n?\na\n${W}`],
    ["a ? card under SM-2", `q\n?\na\n${S}`, at(5, false), `q\n?\na\n${W}`],
    ["a ? card under !fsrs", `q\n?\na\n${F}`, at(4, false), null],
    ["a ? card under SM-2 then !fsrs", `q\n?\na\n${S}\n${F}`, at(5, false), null],
    ["a ? card under !fsrs then SM-2", `q\n?\na\n${F}\n${S}`, at(4, false), null],
    ["a cloze with c1!fsrs, rating c2", `{{c1::a}} {{c2::b}} ${CF}`, at(2, true, 2), null],
    ["a ? cloze under c1!fsrs", `{{c1::a}}\n?\nextra\n${CF}`, at(4, false, 1), null],
  ])("#1929 the writer on %s", (_, body, card, written) => {
    const text = note(body);
    expect(writeSchedule(text, card, NEXT)).toBe(written === null ? text : note(written));
  });

  it("#1929 rating the card beside an !fsrs one leaves that line byte for byte", () => {
    const text = note(`q::a ${F}`);
    const [card] = parseCards(text);
    expect(card?.front).toBe("n");
    expect(writeSchedule(text, card as Card, NEXT)).toBe(
      note(`q::a ${F}`).replace("n::m", `n::m ${W}`),
    );
  });
});
