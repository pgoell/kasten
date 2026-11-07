// @vitest-environment node
import { setSuspended, writeSchedule } from "@/lib/review/card-write";
import { parseCards } from "@/lib/review/srs";
import { only } from "./fixture";

describe("#660 a schedule comment on its own line opens no comment block", () => {
  it("#660 I2 a deck tag under a schedule line still names its deck", () => {
    const text = [
      "#flashcards/a",
      "",
      "front",
      "?",
      "back",
      "<!--SR:!2026-08-20,4,270-->",
      "The capital of France is {{c1::Paris}}.",
      "?",
      "On the Seine.",
      "<!--SR:c1!2026-08-20,4,270-->",
      "#flashcards/b",
      "q::a",
    ].join("\n");

    expect(parseCards(text).map((card) => card.decks)).toEqual([
      ["a", "b"],
      ["a", "b"],
      ["a", "b"],
    ]);
  });
});

describe("#660 only a comment hides a deck tag", () => {
  it("#660 B a deck tag under an html block line still names its deck", () => {
    expect(parseCards('<img src="a.png">\n#flashcards/x\n\nq::a')[0]?.decks).toEqual(["x"]);
  });
});

describe("#664 a code block holds no card and no deck tag", () => {
  /** The fronts of the cards the note holds, in the order written. */
  const fronts = (text: string) => parseCards(text).map((card) => card.front);

  it("#664 A1 a :: line inside a tilde fence is no card", () => {
    expect(fronts("#flashcards/a\n\n~~~\nstd::vector\n~~~\n\nq::a\n")).toEqual(["q"]);
  });

  it.each([
    ["four spaces", "    "],
    ["a tab", "\t"],
  ])("#664 A2 a :: line in an indented code block is no card, indented by %s", (_, indent) => {
    expect(fronts(`#flashcards/a\n\nprose\n\n${indent}std::vector\n\nq::a\n`)).toEqual(["q"]);
  });

  it("#664 A3 a tilde fence holding a :: and a deck tag makes no card and no deck", () => {
    const text = "#flashcards/a\n\nq::a\n\n~~~\n#flashcards/x\nstd::vector\n~~~\n";

    expect(parseCards(text).map(({ front, decks }) => ({ front, decks }))).toEqual([
      { front: "q", decks: ["a"] },
    ]);
  });

  it("#664 I1 a :: line inside a backtick fence, and the fence lines, are no card", () => {
    expect(fronts("#flashcards/a\n\n```a::b\nstd::vector\n```\n\nq::a\n")).toEqual(["q"]);
  });

  it.each([
    ["a tilde fence", "~~~\nq\n?\na\n~~~\n"],
    ["an indented block", "prose\n\n    q\n    ?\n    a\n"],
  ])("#664 I2 a ? card inside %s is no card", (_, code) => {
    expect(fronts(`#flashcards/a\n\n${code}`)).toEqual([]);
  });

  it("#664 I3 a tilde fence nobody closed hides every card under it", () => {
    expect(fronts("#flashcards/a\n\nq::a\n\n~~~\nb::c\n\nd::e\n")).toEqual(["q"]);
  });

  it("#664 I4 a line indented under a list item or a paragraph line is still a card", () => {
    expect(fronts("#flashcards/a\n\n- item\n\n    q::a\n\nprose\n    r::b\n")).toEqual(["q", "r"]);
  });

  it.each([
    ["a tilde fence", "~~~\n#flashcards/x\n~~~"],
    ["an indented code block", "prose\n\n    #flashcards/x"],
  ])("#664 I5 a deck tag inside %s names no deck", (_, code) => {
    expect(only(`${code}\n\nq::a`).decks).toEqual([]);
  });

  it("#664 I6 a fence inside a list item or a blockquote hides its cards", () => {
    const text =
      "#flashcards/a\n\n- item\n  ~~~\n  std::vector\n  ~~~\n\n> ```\n> q::a\n> ```\n\nr::b\n";

    expect(fronts(text)).toEqual(["r"]);
  });
});

describe("#670 a code block is part of a ? card's side, as obsidian-spaced-repetition reads it", () => {
  it("#670 a ? card's back holding a fence keeps the fence, the prose under it and its schedule", () => {
    const text =
      "#flashcards/a\n\nq\n?\nprose\n```\ncode\n```\nmore prose\n<!--SR:!2026-08-20,3,250-->\n";

    expect(parseCards(text).map(({ to, back, held }) => ({ to, back, held }))).toEqual([
      {
        to: 9,
        back: "prose\n```\ncode\n```\nmore prose",
        held: { due: "2026-08-20", interval: 3, ease: 250 },
      },
    ]);
  });
});

describe("#674 an imported side opening with an escaped tilde fence", () => {
  it("#674 A2 a side opening with an escaped tilde fence is a card and hides none under it", () => {
    const text =
      "#flashcards/x\n\n\\~~~::code <!--anki:1:0:abcdef12-->\n\na::b <!--anki:2:0:abcdef12-->\n";

    expect(parseCards(text).map((card) => card.front)).toEqual(["\\~~~", "a"]);
  });
});

describe("#675 a blank line inside a fence ends no question card", () => {
  /** A card whose back holds a fence with a blank line in it, and its schedule under the fence. */
  const BLANK =
    "#flashcards/a\n\nq\n?\nanswer\n```py\na = 1\n\nb = 2\n```\n<!--SR:!2026-08-20,3,250-->\n";

  it("#675 A4 a blank line inside a fence does not end a question card's back", () => {
    expect(parseCards(BLANK).map(({ to, back, held }) => ({ to, back, held }))).toEqual([
      {
        to: 10,
        back: "answer\n```py\na = 1\n\nb = 2\n```",
        held: { due: "2026-08-20", interval: 3, ease: 250 },
      },
    ]);
  });

  it("#675 A5 a blank line inside a fence does not end a question card's front", () => {
    const text = "#flashcards/a\n\n```py\na = 1\n\nb = 2\n```\nq\n?\nanswer\n";

    expect(parseCards(text).map(({ from, front, back }) => ({ from, front, back }))).toEqual([
      { from: 2, front: "```py\na = 1\n\nb = 2\n```\nq", back: "answer" },
    ]);
  });

  it("#675 A6 a rating rewrites the one schedule after the fence and writes no second", () => {
    const next = { due: "2026-09-01", interval: 12, ease: 250 };
    const written = writeSchedule(BLANK, only(BLANK), next);

    expect({ schedules: written.split("<!--SR:").length - 1, written }).toEqual({
      schedules: 1,
      written: BLANK.replace("<!--SR:!2026-08-20,3,250-->", "<!--SR:!2026-09-01,12,250-->"),
    });
  });

  it("#675 I3 a heading and a tags-only line inside a fence end no back and name no deck", () => {
    const text =
      "#flashcards/a\n\nq\n?\nanswer\n```sh\n# comment\n#flashcards/x\n```\n<!--SR:!2026-08-01,3,250-->\n";
    const card = only(text);

    expect(card.decks).toEqual(["a"]);
    expect({ to: card.to, back: card.back, held: card.held }).toEqual({
      to: 9,
      back: "answer\n```sh\n# comment\n#flashcards/x\n```",
      held: { due: "2026-08-01", interval: 3, ease: 250 },
    });
  });

  it("#675 I4 two ratings of a card whose fence nobody closed keep one schedule", () => {
    const text = "#flashcards/a\n\nq\n?\nanswer\n~~~\na = 1\n";
    const second = { due: "2026-08-17", interval: 3, ease: 250 };
    const once = writeSchedule(text, only(text), { due: "2026-08-14", interval: 1, ease: 250 });
    const twice = writeSchedule(once, only(once), second);

    expect(twice.split("<!--SR:").length - 1).toBe(1);
    expect(only(twice).held).toEqual(second);
    expect(twice).toBe(`${text}<!--SR:!2026-08-17,3,250-->\n`);
  });

  it("#675 I5 parking and unparking a card with a blank line in its fence", () => {
    const on = setSuspended(BLANK, only(BLANK), true);
    const off = setSuspended(on, only(on), false);

    expect(off).toBe(BLANK);
    expect(on).toBe(BLANK.replace("<!--SR:", "!suspended <!--SR:"));
  });

  it("#675 I6 a blank line outside the fence still ends the card", () => {
    const text = "#flashcards/a\n\nq\n?\nanswer\n```\na = 1\n\nb = 2\n```\n\nr\n?\nother\n";

    expect(parseCards(text).map(({ from, to, front }) => ({ from, to, front }))).toEqual([
      { from: 2, to: 9, front: "q" },
      { from: 11, to: 13, front: "r" },
    ]);
  });

  it("#675 R1 parking a card whose fence nobody closed parks it", () => {
    const text = "#flashcards/a\n\nq\n?\nanswer\n~~~\na = 1\n";
    const on = setSuspended(text, only(text), true);

    expect(on).toBe(`${text}!suspended\n`);
    expect(only(on).parked).toBe("suspended");
  });

  it("#675 R2 the front walk stops at the schedule of the card above a fence", () => {
    const fence = "```py\na = 1\n\nb = 2\n```";
    const held = { due: "2026-08-20", interval: 3, ease: 250 };
    const cards = (text: string) =>
      parseCards(text).map(({ from, to, front, held }) => ({ from, to, front, held }));

    expect({
      inline: cards(`#flashcards/a\n\na::b <!--SR:!2026-08-20,3,250-->\n${fence}\nq\n?\nans\n`),
      question: cards(
        `#flashcards/a\n\nq1\n?\na1\n<!--SR:!2026-08-20,3,250-->\n${fence}\nq2\n?\na2\n`,
      ),
    }).toEqual({
      inline: [
        { from: 2, to: 2, front: "a", held },
        { from: 3, to: 10, front: `${fence}\nq`, held: null },
      ],
      question: [
        { from: 2, to: 5, front: "q1", held },
        { from: 6, to: 13, front: `${fence}\nq2`, held: null },
      ],
    });
  });
});

describe("#680 a fence nobody closed crosses no blank line", () => {
  it("#680 a card above a fence nobody closed keeps its hands off the schedule of the card hidden under it", () => {
    const text = "#flashcards/a\n\nq1\n?\na1\n~~~\nx\n\nq2\n?\na2\n<!--SR:!2026-08-20,3,250-->\n";
    const card = only(text);
    const next = { due: "2026-08-21", interval: 1, ease: 250 };

    expect({ to: card.to, back: card.back, held: card.held }).toEqual({
      to: 6,
      back: "a1\n~~~\nx",
      held: null,
    });
    expect(writeSchedule(text, card, next)).toBe(
      "#flashcards/a\n\nq1\n?\na1\n~~~\nx\n<!--SR:!2026-08-21,1,250-->\n\nq2\n?\na2\n<!--SR:!2026-08-20,3,250-->\n",
    );
  });
});

describe("#665 an html comment holds no card", () => {
  /** The fronts of the cards the note holds, in the order written. */
  const fronts = (text: string) => parseCards(text).map((card) => card.front);

  it("#665 a :: line inside a comment over several lines is no card", () => {
    expect(parseCards("#flashcards/x\n\n<!--\nq::a\n-->\n")).toEqual([]);
  });

  it("#665 a ? card inside a comment over several lines is no card", () => {
    expect(fronts("#flashcards/x\n\n<!--\nq\n?\na\n-->\n\nr::b\n")).toEqual(["r"]);
  });

  it("#665 a cloze line inside a comment is no card", () => {
    expect(fronts("#flashcards/x\n\n<!--\nThe {{c1::WAL}} is a log.\n-->\n")).toEqual([]);
  });

  it("#665 the cards above and below a comment are still asked, each with its own schedule", () => {
    const text = [
      "#flashcards/x",
      "",
      "q",
      "?",
      "a",
      "<!--",
      "hidden::no",
      "-->",
      "r::b <!--SR:!2026-08-20,4,270-->",
    ].join("\n");

    expect(
      parseCards(text).map(({ from, to, front, back, held }) => ({ from, to, front, back, held })),
    ).toEqual([
      { from: 2, to: 4, front: "q", back: "a", held: null },
      {
        from: 8,
        to: 8,
        front: "r",
        back: "b",
        held: { due: "2026-08-20", interval: 4, ease: 270 },
      },
    ]);
  });

  it.each([
    ["on one line", "<!-- q::a -->"],
    ["opened after three spaces", "   <!-- q::a -->"],
  ])("#665 a comment %s holds no card", (_, comment) => {
    expect(fronts(`#flashcards/x\n\n${comment}\n\nr::b\n`)).toEqual(["r"]);
  });

  it("#665 a schedule on its own line still holds its card's schedule", () => {
    expect(only("#flashcards/x\n\nq\n?\na\n<!--SR:!2026-08-20,4,270-->\n").held).toEqual({
      due: "2026-08-20",
      interval: 4,
      ease: 270,
    });
  });

  it("#665 a comment nobody closes hides every card under it", () => {
    expect(fronts("#flashcards/x\n\nr::b\n\n<!--\nq::a\n\ns::c\n")).toEqual(["r"]);
  });
});

describe("#1477 a comment that opens mid-paragraph holds no card", () => {
  const fronts = (text: string) => parseCards(text).map((card) => card.front);

  it("#1477 a :: line inside a comment opened after text is no card", () => {
    expect(fronts("#flashcards/x\n\ntext <!--\nq::a\n-->\n\nr::b\n")).toEqual(["r"]);
  });

  it("#1477 a ? card inside a comment opened after text is no card", () => {
    expect(fronts("#flashcards/x\n\ntext <!--\nq\n?\na\n-->\n\nr::b\n")).toEqual(["r"]);
  });

  it("#1477 a card with its schedule on its line keeps both", () => {
    expect(only("#flashcards/x\n\nq::a <!--SR:!2026-08-20,4,270-->\n").held).toEqual({
      due: "2026-08-20",
      interval: 4,
      ease: 270,
    });
  });

  it("#1477 the card under a closed comment is still asked", () => {
    expect(fronts("#flashcards/x\n\ntext <!--\nhidden::no\n-->\nr::b\n")).toEqual(["r"]);
  });

  it("#1477 a <!-- nobody closes in its paragraph is text", () => {
    expect(fronts("#flashcards/x\n\ntext <!--\nq::a\n\nr::b\n")).toEqual(["q", "r"]);
  });
});

describe("#1547 a :: inside a one-line comment after text is no card", () => {
  const fronts = (text: string) => parseCards(text).map((card) => card.front);

  it("#1547 a :: inside a comment after text is no card", () => {
    expect(fronts("#flashcards/x\n\ntext <!-- q::a -->\n\nr::b\n")).toEqual(["r"]);
  });

  it("#1547 a :: inside a comment after text in the deck tag's paragraph is no card", () => {
    expect(fronts("#flashcards/x\ntext <!-- q::a -->\n\nr::b\n")).toEqual(["r"]);
  });

  it("#1547 a :: on the opening line of a comment over several lines is no card", () => {
    expect(fronts("#flashcards/x\n\ntext <!-- q::a\nmore -->\n\nr::b\n")).toEqual(["r"]);
  });

  it("#1547 a card splits at the :: outside the comment", () => {
    const card = only("#flashcards/x\n\ntext <!-- q::a --> more::b\n");
    expect([card.front, card.back]).toEqual(["text <!-- q::a --> more", "b"]);
  });

  it("#1547 a comment in a card's back stays in the back", () => {
    const card = only("#flashcards/x\n\nq::a <!-- note::x -->\n");
    expect([card.front, card.back]).toEqual(["q", "a <!-- note::x -->"]);
  });

  it.each([
    ["escaped", "text \\<!-- q::a -->", "text \\<!-- q"],
    ["in code spans", "`<!--` q::a `-->`", "`<!--` q"],
  ])("#1547 a <!-- %s is text, so its line is a card", (_, line, front) => {
    expect(fronts(`#flashcards/x\n\n${line}\n`)).toEqual([front]);
  });

  it("#1547 a ? card's question runs up through the line", () => {
    expect(fronts("#flashcards/x\n\ntext <!-- q::a -->\nfront\n?\nback\n")).toEqual([
      "text <!-- q::a -->\nfront",
    ]);
  });
});

describe("#1479 a comment after a list or quote marker holds no card", () => {
  const fronts = (text: string) => parseCards(text).map((card) => card.front);

  it.each([
    ["a list marker", "- <!-- q::a -->"],
    ["a quote marker", "> <!-- q::a -->"],
    ["an ordered list marker", "1. <!-- q::a -->"],
    ["a quote and a list marker", "> - <!-- q::a -->"],
  ])("#1479 a comment after %s holds no card", (_, comment) => {
    expect(fronts(`#flashcards/x\n\n${comment}\n\nr::b\n`)).toEqual(["r"]);
  });

  it("#1479 a card before the comment in a list item is still a card with its schedule", () => {
    const card = only("#flashcards/x\n\n- q::a <!--SR:!2026-08-20,4,270-->\n");
    expect([card.front, card.held?.due]).toEqual(["- q", "2026-08-20"]);
  });
});

describe("#1579 a comment after text on its line holds no card", () => {
  const fronts = (text: string) => parseCards(text).map((card) => card.front);

  it("#1579 a cloze inside a one-line comment after text makes no card", () => {
    expect(parseCards("#flashcards/x\n\ntext <!-- {{c1::x}} -->\n")).toEqual([]);
  });

  it("#1579 a cloze with a comment after it on its line stays a cloze", () => {
    const cards = parseCards("#flashcards/x\n\n{{c1::x}} <!-- note -->\n");
    expect(cards.map((card) => card.cloze)).toEqual([1]);
  });

  it("#1579 a cloze with a schedule comment after it keeps its schedule", () => {
    const card = only("#flashcards/x\n\n{{c1::x}} <!--SR:c1!2026-08-20,4,270-->\n");
    expect([card.cloze, card.held?.due]).toEqual([1, "2026-08-20"]);
  });

  it("#1579 a plain card inside a one-line comment after text makes no card", () => {
    expect(fronts("#flashcards/x\n\ntext <!-- a::b -->\n")).toEqual([]);
  });
});
