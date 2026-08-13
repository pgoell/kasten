import { nextSchedule, parseCards, readSchedule, writeSchedule } from "@/lib/srs";

const NOTE = `---
id: 019fd770-e40a-72e7-9abc-2cc62eeaeb19
---
# AWS drills

#flashcards/aws

What does S3 stand for?::Simple Storage Service

The three storage classes worth knowing
?
Standard, Infrequent Access, Glacier
`;

describe("parseCards", () => {
  it("reads a card written on one line", () => {
    const [card] = parseCards(NOTE);
    expect(card.front).toBe("What does S3 stand for?");
    expect(card.back).toBe("Simple Storage Service");
    expect(card.inline).toBe(true);
    expect(card.held).toBeNull();
  });

  it("reads a card written over three lines", () => {
    const card = parseCards(NOTE)[1];
    expect(card.front).toBe("The three storage classes worth knowing");
    expect(card.back).toBe("Standard, Infrequent Access, Glacier");
    expect(card.inline).toBe(false);
  });

  it("spans the lines the card is written on", () => {
    const lines = NOTE.split("\n");
    const [one, two] = parseCards(NOTE);
    expect(lines[one.from]).toContain("S3");
    expect(one.from).toBe(one.to);
    expect(lines[two.from]).toBe("The three storage classes worth knowing");
    expect(lines[two.to]).toBe("Standard, Infrequent Access, Glacier");
  });

  it("keeps the schedule off the back of the card", () => {
    const [inline, multi] = parseCards(`a::b <!--SR:!2026-08-20,4,270-->

q
?
r
<!--SR:!2026-08-14,1,230-->
`);
    expect(inline.back).toBe("b");
    expect(inline.held).toEqual({ due: "2026-08-20", interval: 4, ease: 270 });
    expect(multi.back).toBe("r");
    expect(multi.held).toEqual({ due: "2026-08-14", interval: 1, ease: 230 });
  });

  it("takes the schedule line into the card's span", () => {
    const text = "q\n?\nr\n<!--SR:!2026-08-14,1,230-->\n";
    const [card] = parseCards(text);
    expect(text.split("\n")[card.to]).toContain("SR:");
  });

  it("does not read a fenced code block", () => {
    const cards = parseCards("```cpp\nstd::vector<int> v;\n```\n\nreal::card\n");
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe("real");
  });

  it("reads a back running over several lines", () => {
    const [card] = parseCards("q\n?\nfirst\nsecond\n\nafter\n");
    expect(card.back).toBe("first\nsecond");
  });

  it("stops a back at the next heading", () => {
    const [card] = parseCards("q\n?\nanswer\n## Next\n");
    expect(card.back).toBe("answer");
  });

  it("finds nothing in a note holding no card", () => {
    expect(parseCards("# Title\n\nordinary prose.\n")).toEqual([]);
  });
});

describe("readSchedule", () => {
  it("reads the three numbers the comment holds", () => {
    expect(readSchedule("a::b <!--SR:!2026-08-20,4,270-->")).toEqual({
      due: "2026-08-20",
      interval: 4,
      ease: 270,
    });
  });

  it("answers nothing for a line carrying no comment", () => {
    expect(readSchedule("a::b")).toBeNull();
  });
});

describe("nextSchedule", () => {
  const TODAY = "2026-08-13";

  it("starts a card nobody has answered", () => {
    expect(nextSchedule(null, "good", TODAY)).toEqual({
      due: "2026-08-14",
      interval: 1,
      ease: 250,
    });
    expect(nextSchedule(null, "easy", TODAY).interval).toBe(4);
    expect(nextSchedule(null, "hard", TODAY).interval).toBe(1);
    expect(nextSchedule(null, "again", TODAY).interval).toBe(1);
    for (const rating of ["again", "hard", "good", "easy"] as const) {
      expect(nextSchedule(null, rating, TODAY).ease).toBe(250);
    }
  });

  const held = { due: TODAY, interval: 4, ease: 250 };

  it("multiplies by the ease on good, leaving the ease alone", () => {
    expect(nextSchedule(held, "good", TODAY)).toEqual({
      due: "2026-08-23",
      interval: 10,
      ease: 250,
    });
  });

  it("takes 15 off the ease on hard and grows the interval by a fifth", () => {
    expect(nextSchedule(held, "hard", TODAY)).toMatchObject({ interval: 5, ease: 235 });
  });

  it("adds 15 to the ease on easy before multiplying, then adds the bonus", () => {
    // 4 × 2.65 × 1.3, rounded.
    expect(nextSchedule(held, "easy", TODAY)).toMatchObject({ interval: 14, ease: 265 });
  });

  it("halves the interval on again and takes 20 off the ease", () => {
    expect(nextSchedule(held, "again", TODAY)).toMatchObject({ interval: 2, ease: 230 });
  });

  it("never lets an interval fall below a day", () => {
    expect(nextSchedule({ due: TODAY, interval: 1, ease: 250 }, "again", TODAY).interval).toBe(1);
  });

  it("never lets the ease fall below 130", () => {
    const sunk = { due: TODAY, interval: 10, ease: 140 };
    expect(nextSchedule(sunk, "again", TODAY).ease).toBe(130);
    expect(nextSchedule({ ...sunk, ease: 130 }, "hard", TODAY).ease).toBe(130);
  });

  it("counts the days forward over the end of a month", () => {
    expect(nextSchedule(null, "easy", "2026-08-30").due).toBe("2026-09-03");
    expect(nextSchedule(null, "good", "2026-12-31").due).toBe("2027-01-01");
  });
});

describe("writeSchedule", () => {
  const next = { due: "2026-09-01", interval: 7, ease: 250 };

  it("puts a comment on the end of a card written on one line", () => {
    const text = "# Deck\n\na::b\n";
    const [card] = parseCards(text);
    expect(writeSchedule(text, card, next)).toBe("# Deck\n\na::b <!--SR:!2026-09-01,7,250-->\n");
  });

  it("puts a comment under a card written over several lines", () => {
    const text = "q\n?\nr\n";
    const [card] = parseCards(text);
    expect(writeSchedule(text, card, next)).toBe("q\n?\nr\n<!--SR:!2026-09-01,7,250-->\n");
  });

  it("replaces the comment a card already carries rather than adding a second", () => {
    const inline = "a::b <!--SR:!2026-08-01,2,240-->\n";
    expect(writeSchedule(inline, parseCards(inline)[0], next)).toBe(
      "a::b <!--SR:!2026-09-01,7,250-->\n",
    );
    const multi = "q\n?\nr\n<!--SR:!2026-08-01,2,240-->\n";
    expect(writeSchedule(multi, parseCards(multi)[0], next)).toBe(
      "q\n?\nr\n<!--SR:!2026-09-01,7,250-->\n",
    );
  });

  it("leaves every other line of the note exactly as it was", () => {
    const [card] = parseCards(NOTE);
    const written = writeSchedule(NOTE, card, next).split("\n");
    const before = NOTE.split("\n");
    for (const [at, line] of before.entries()) {
      if (at === card.from) continue;
      expect(written[at]).toBe(line);
    }
  });
});
