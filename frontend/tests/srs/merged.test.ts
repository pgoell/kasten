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

describe("#1926 a card with the plugin's !fsrs comment is read and rated by FSRS", () => {
  const F = "<!--SR:!fsrs,2026-11-20T00:00:00.000Z,8,8.30,1.00,2,1,0,0,2026-11-12T00:00:00.000Z-->";
  const FH = {
    due: "2026-11-20",
    interval: 8,
    stability: 8.3,
    difficulty: 1,
    state: 2,
    reps: 1,
    lapses: 0,
    steps: 0,
    last: "2026-11-12",
  };
  const CF = F.replace("SR:!", "SR:c1!");
  // Answered 2026-08-16, before the FSRS answer, so the FSRS one wins.
  const S = "<!--SR:!2026-08-20,4,270-->";
  const SH = { due: "2026-08-20", interval: 4, ease: 270 };
  // A first answer the same day as the FSRS one, as a tab from before #1929 writes it.
  const T = "<!--SR:!2026-11-13,1,250-->";
  const TH = { due: "2026-11-13", interval: 1, ease: 250 };
  const BAD = [
    "<!--SR:!fsrs,2026-11-20T00:00:00.000Z,8,x,1.00,2,1,0,0,-->",
    `${F.slice(0, -3)}!fsrs,2026-11-21T00:00:00.000Z,1,1,1,2,1,0,0,--->`,
    `${F.slice(0, -3)}!2026-11-21,1,250-->`,
  ];
  const note = (body: string) => `#flashcards/x\n\n${body}\n\nn::m\n`;
  const read = (body: string) =>
    parseCards(note(body)).map((card) => [card.front, card.held, card.parked]);
  const N = ["n", null, null];

  it.each([
    ["an SM-2 comment", `q::a ${S}`, [["q", SH, null], N]],
    ["no comment", "q::a", [["q", null, null], N]],
    ["an !fsrs comment", `q::a ${F}`, [["q", FH, null], N]],
    ["!fsrs then an older SM-2", `q::a ${F} ${S}`, [["q", FH, null], N]],
    ["an older SM-2 then !fsrs", `q::a ${S} ${F}`, [["q", FH, null], N]],
    ["!fsrs then a same-day SM-2", `q::a ${F} ${T}`, [["q", TH, null], N]],
    ["an escaped !fsrs comment", `q::a ${F.replace("SR:", "SR\\:")}`, [["q", null, null], N]],
    ["a ? card under SM-2", `q\n?\na\n${S}`, [["q", SH, null], N]],
    ["a ? card under !fsrs", `q\n?\na::b\n${F}`, [["q", FH, null], N]],
    ["a ? card under an older SM-2 then !fsrs", `q\n?\na::b\n${S}\n${F}`, [["q", FH, null], N]],
    ["a ? card under a same-day SM-2 then !fsrs", `q\n?\na::b\n${T}\n${F}`, [["q", TH, null], N]],
    ["a ? card under !fsrs then SM-2", `q\n?\na::b\n${F}\n${S}`, [["q", FH, null], N]],
    ["a parked ? card under !fsrs", `q\n?\na\n!suspended ${F}`, [["q", FH, "suspended"], N]],
    ["a parked one-line card", `q::a !suspended ${F}`, [["q", FH, "suspended"], N]],
    [
      "a ? card under SM-2 over a one-line !fsrs card",
      `q\n?\na\n${S}\nx::y ${F}`,
      [["q", SH, null], ["x", FH, null], N],
    ],
    [
      "a parked ? card under SM-2 over a one-line !fsrs card",
      `q\n?\na\n!suspended ${S}\nx::y ${F}`,
      [["q", SH, "suspended"], ["x", FH, null], N],
    ],
    // The fence runs to the end, so it takes the card under it too; SM-2 reads the same.
    ["a ? card under !fsrs in an unclosed fence", `q\n?\na\n\`\`\`\n${F}`, [["q", FH, null]]],
    ["a ? card under SM-2 in an unclosed fence", `q\n?\na\n\`\`\`\n${S}`, [["q", SH, null]]],
    [
      "a cloze with c1!fsrs",
      `{{c1::a}} {{c2::b}} ${CF}`,
      [["\\[...\\] b", FH, null], ["a \\[...\\]", null, null], N],
    ],
    ["a ? cloze under c1!fsrs", `{{c1::a}}\n?\nextra\n${CF}`, [["\\[...\\]", FH, null], N]],
    // A plain card takes no cloze number's line, FSRS's as SM-2's (review round 1).
    ["a plain ? card over a c1!fsrs line", `q\n?\na\n${CF}`, [["q", null, null], N]],
    [
      "a plain ? card over a c1 SM-2 line",
      `q\n?\na\n${S.replace("SR:!", "SR:c1!")}`,
      [["q", null, null], N],
    ],
    ["a plain ? card under SM-2 over a c1!fsrs line", `q\n?\na\n${S}\n${CF}`, [["q", SH, null], N]],
    ...BAD.map((bad, at) => [`an !fsrs comment that does not read, ${at}`, `q::a ${bad}`, [N]]),
    ["a ? card under an !fsrs comment that does not read", `q\n?\na\n${BAD[0]}`, [N]],
    ["a ? card under SM-2 over one that does not read", `q\n?\na\n${S}\n${BAD[0]}`, [N]],
  ] as [string, string, unknown[]][])("#1926 the reader on %s", (_, body, cards) => {
    expect(read(body)).toEqual(cards);
  });

  it("#1926 a card's tags at its head stay its own beside an !fsrs comment", () => {
    const decks = (body: string) => parseCards(note(body)).at(-1)?.decks;
    expect(decks(`#flashcards/y q::a ${F}`)).toEqual(decks(`#flashcards/y q::a ${S}`));
    expect(decks(`#flashcards/y q::a ${BAD[0]}`)).toEqual(decks(`#flashcards/y q::a ${S}`));
  });

  const NEXT = {
    ...FH,
    due: "2026-12-01",
    interval: 19,
    stability: 19.04,
    reps: 2,
    last: "2026-11-12",
  };
  const W =
    "<!--SR:!fsrs,2026-12-01T00:00:00.000Z,19,19.04,1.00,2,2,0,0,2026-11-12T00:00:00.000Z-->";
  const at = (to: number, inline: boolean, cloze: number | null = null) =>
    ({ from: 2, to, inline, cloze }) as Card;

  it.each([
    ["no comment", "q::a", at(2, true), `q::a ${W}`],
    ["an SM-2 comment", `q::a ${S}`, at(2, true), `q::a ${W}`],
    ["an !fsrs comment", `q::a ${F}`, at(2, true), `q::a ${W}`],
    ["!fsrs then SM-2", `q::a ${F} ${S} tail`, at(2, true), `q::a ${W} tail`],
    ["SM-2 then !fsrs", `q::a ${S} ${F}`, at(2, true), `q::a ${W}`],
    ["a parked one-line card", `q::a !suspended ${F}`, at(2, true), `q::a !suspended ${W}`],
    ["a ? card with none", "q\n?\na", at(4, false), `q\n?\na\n${W}`],
    ["a ? card under SM-2", `q\n?\na\n${S}`, at(5, false), `q\n?\na\n${W}`],
    ["a ? card under !fsrs", `q\n?\na\n${F}`, at(5, false), `q\n?\na\n${W}`],
    ["a ? card under SM-2 then !fsrs", `q\n?\na\n${S}\n${F}`, at(6, false), `q\n?\na\n${W}`],
    [
      "a parked ? card under SM-2 then !fsrs",
      `q\n?\na\n!suspended ${S}\n${F}`,
      at(6, false),
      `q\n?\na\n!suspended ${W}`,
    ],
    ["a ? card under !fsrs then SM-2", `q\n?\na\n${F}\n${S}`, at(5, false), `q\n?\na\n${W}\n${S}`],
    [
      "a ? card under SM-2 over a one-line !fsrs card",
      `q\n?\na\n${S}\nx::y ${F}`,
      at(5, false),
      `q\n?\na\n${W}\nx::y ${F}`,
    ],
    [
      "a cloze with c1!fsrs, rating c2",
      `{{c1::a}} {{c2::b}} ${CF}`,
      at(2, true, 2),
      `{{c1::a}} {{c2::b}} ${CF} ${W.replace("SR:!", "SR:c2!")}`,
    ],
    [
      "a cloze with c1!fsrs, rating c1",
      `{{c1::a}} {{c2::b}} ${CF}`,
      at(2, true, 1),
      `{{c1::a}} {{c2::b}} ${W.replace("SR:!", "SR:c1!")}`,
    ],
    [
      "a ? cloze under c1!fsrs",
      `{{c1::a}}\n?\nextra\n${CF}`,
      at(5, false, 1),
      `{{c1::a}}\n?\nextra\n${W.replace("SR:!", "SR:c1!")}`,
    ],
    [
      "a ? cloze under c2 SM-2 then c1!fsrs, rating c2",
      `{{c1::a}} {{c2::b}}\n?\nx\n${S.replace("SR:!", "SR:c2!")}\n${CF}`,
      at(6, false, 2),
      `{{c1::a}} {{c2::b}}\n?\nx\n${W.replace("SR:!", "SR:c2!")} ${CF}`,
    ],
    ["a plain ? card over a c1!fsrs line", `q\n?\na\n${CF}`, at(4, false), `q\n?\na\n${W}\n${CF}`],
    [
      "a plain ? card under SM-2 over a c1!fsrs line",
      `q\n?\na\n${S}\n${CF}`,
      at(5, false),
      `q\n?\na\n${W}\n${CF}`,
    ],
    ...BAD.map((bad, at_) => [
      `an !fsrs comment that does not read, ${at_}`,
      `q::a ${bad}`,
      at(2, true),
      null,
    ]),
    [
      "a ? card under SM-2 over one that does not read",
      `q\n?\na\n${S}\n${BAD[0]}`,
      at(6, false),
      null,
    ],
  ] as [string, string, Card, string | null][])(
    "#1926 the writer on %s",
    (_, body, card, written) => {
      const text = note(body);
      expect(writeSchedule(text, card, NEXT)).toBe(written === null ? text : note(written));
    },
  );

  it("#1926 every card the reader reads, rated, reads back as the schedule written, and a second rating adds no comment", () => {
    const bodies = [
      `q::a ${F} ${S}`,
      `q\n?\na\n${T}\n${F}`,
      `q\n?\na\n!suspended ${F}`,
      `{{c1::a}} {{c2::b}} ${CF}`,
      `q\n?\na\n${CF}`,
    ];
    for (const body of bodies) {
      for (const [ordinal, card] of parseCards(note(body)).entries()) {
        const once = writeSchedule(note(body), card, NEXT);
        const after = parseCards(once);
        // A second rating rewrites the comment it wrote and adds none.
        const twice = writeSchedule(once, after[ordinal] as Card, NEXT);
        const count = (text: string) => text.match(/<!--SR:/g)?.length;
        expect({ body, ordinal, held: after[ordinal]?.held, comments: count(twice) }).toEqual({
          body,
          ordinal,
          held: NEXT,
          comments: count(once),
        });
      }
    }
  });
});
