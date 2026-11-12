// @vitest-environment node
import { readFileSync } from "node:fs";
import { createEmptyCard, fsrs } from "ts-fsrs";
import { shiftDay } from "@/lib/core/clock";
import { sameAnswer } from "@/lib/review/card-text";
import { setSuspended, writeSchedule } from "@/lib/review/card-write";
import {
  answeredToday,
  learning,
  nextFsrs,
  nextSchedule,
  readNoteSchedule,
  readNoteSuspended,
  writeNoteSchedule,
  writeNoteSuspended,
} from "@/lib/review/srs-schedule";
import { NOTE, only } from "./srs/fixture";

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
    expect(nextSchedule(null, "again", TODAY)).toEqual({ due: TODAY, interval: 0, ease: 250 });
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
    expect(writeSchedule(text, only(text), next)).toBe(
      "# Deck\n\na::b <!--SR:!2026-09-01,7,250-->\n",
    );
  });

  it("puts a comment under a card written over several lines", () => {
    const text = "q\n?\nr\n";
    expect(writeSchedule(text, only(text), next)).toBe("q\n?\nr\n<!--SR:!2026-09-01,7,250-->\n");
  });

  it("replaces the comment a card already carries rather than adding a second", () => {
    const inline = "a::b <!--SR:!2026-08-01,2,240-->\n";
    expect(writeSchedule(inline, only(inline), next)).toBe("a::b <!--SR:!2026-09-01,7,250-->\n");
    const multi = "q\n?\nr\n<!--SR:!2026-08-01,2,240-->\n";
    expect(writeSchedule(multi, only(multi), next)).toBe("q\n?\nr\n<!--SR:!2026-09-01,7,250-->\n");
  });

  it("leaves every other line of the note exactly as it was", () => {
    const card = only(NOTE);
    const written = writeSchedule(NOTE, card, next).split("\n");
    const before = NOTE.split("\n");
    for (const [at, line] of before.entries()) {
      if (at === card.from) continue;
      expect(written[at]).toBe(line);
    }
  });
});

describe("sameAnswer", () => {
  it("forgives space, case and a trailing stop", () => {
    expect(sameAnswer("  simple storage service ", "Simple Storage Service")).toBe(true);
    expect(sameAnswer("Simple  Storage\tService", "Simple Storage Service")).toBe(true);
    expect(sameAnswer("Simple Storage Service", "Simple Storage Service.")).toBe(true);
  });

  it("does not forgive a different word", () => {
    expect(sameAnswer("Simple Store Service", "Simple Storage Service")).toBe(false);
    expect(sameAnswer("", "Simple Storage Service")).toBe(false);
  });
});

describe("readNoteSchedule", () => {
  it("reads the three fields off the frontmatter", () => {
    const note = "---\nid: 1\nsr-due: 2026-08-20\nsr-interval: 4\nsr-ease: 270\n---\n# TLS\n";
    expect(readNoteSchedule(note)).toEqual({ due: "2026-08-20", interval: 4, ease: 270 });
  });

  it("answers nothing where the note carries none of them", () => {
    expect(readNoteSchedule("---\nid: 1\n---\n# TLS\n")).toBeNull();
  });

  it("takes a due date written by hand as a card nothing has answered", () => {
    expect(readNoteSchedule("---\nsr-due: 2026-08-20\n---\n")).toEqual({
      due: "2026-08-20",
      interval: 1,
      ease: 250,
    });
  });
});

describe("writeNoteSchedule", () => {
  const next = { due: "2026-09-01", interval: 7, ease: 265 };

  it("sets the three fields, keeping the ones already there", () => {
    const note = "---\nid: 1\n---\n# TLS\n\nbody\n";
    expect(writeNoteSchedule(note, next)).toBe(
      "---\nid: 1\nsr-due: 2026-09-01\nsr-interval: 7\nsr-ease: 265\n---\n# TLS\n\nbody\n",
    );
  });

  it("mints a block for a note that has none, keeping the body whole", () => {
    expect(writeNoteSchedule("# TLS\n\nbody\n", next)).toBe(
      "---\nsr-due: 2026-09-01\nsr-interval: 7\nsr-ease: 265\n---\n# TLS\n\nbody\n",
    );
  });

  it("moves a schedule the note already carried rather than adding a second", () => {
    const note = "---\nsr-due: 2026-01-01\nsr-interval: 1\nsr-ease: 250\n---\n# TLS\n";
    const written = writeNoteSchedule(note, next);
    expect(written.match(/sr-due:/g)).toHaveLength(1);
    expect(written).toContain("sr-due: 2026-09-01");
  });
});

describe("readNoteSuspended", () => {
  it("reads the field as true only for the word", () => {
    expect(readNoteSuspended("---\nsr-suspended: true\n---\n# TLS\n")).toBe(true);
  });

  it("is false where the field says so", () => {
    expect(readNoteSuspended("---\nsr-suspended: false\n---\n# TLS\n")).toBe(false);
  });

  it("is false where the note carries no such field", () => {
    expect(readNoteSuspended("---\nid: 1\n---\n# TLS\n")).toBe(false);
  });
});

describe("writeNoteSuspended", () => {
  it("writes a note the reader takes as suspended", () => {
    const written = writeNoteSuspended("---\nid: 1\n---\n# TLS\n", true);
    expect(readNoteSuspended(written)).toBe(true);
  });

  it("leaves the note's schedule where it was", () => {
    const note = "---\nsr-due: 2026-08-20\nsr-interval: 4\nsr-ease: 250\n---\n# TLS\n";
    const written = writeNoteSuspended(note, true);
    expect(written).toContain("sr-due: 2026-08-20");
    expect(readNoteSchedule(written)).toEqual({ due: "2026-08-20", interval: 4, ease: 250 });
  });

  it("sets the field to false rather than taking it out", () => {
    const written = writeNoteSuspended("---\nsr-suspended: true\n---\n# TLS\n", false);
    expect(written).toContain("sr-suspended: false");
    expect(readNoteSuspended(written)).toBe(false);
  });
});

describe("setSuspended", () => {
  const INLINE_HELD = "a::b <!--SR:!2026-08-20,4,270-->\n";
  const INLINE_FRESH = "a::b\n";
  const MULTI_HELD = "q\n?\nr\n<!--SR:!2026-08-14,1,230-->\n";
  const MULTI_FRESH = "q\n?\nr\n";

  /** Park it, read the note back, and put it back. */
  function roundTrip(text: string): string {
    const parked = setSuspended(text, only(text), true);
    return setSuspended(parked, only(parked), false);
  }

  it("puts the token between the answer and the comment on a one-line card", () => {
    expect(setSuspended(INLINE_HELD, only(INLINE_HELD), true)).toBe(
      "a::b !suspended <!--SR:!2026-08-20,4,270-->\n",
    );
  });

  it("puts it on the end of a one-line card carrying no comment", () => {
    expect(setSuspended(INLINE_FRESH, only(INLINE_FRESH), true)).toBe("a::b !suspended\n");
  });

  it("puts it at the head of the schedule's line on a card written over several", () => {
    expect(setSuspended(MULTI_HELD, only(MULTI_HELD), true)).toBe(
      "q\n?\nr\n!suspended <!--SR:!2026-08-14,1,230-->\n",
    );
  });

  it("splices a line of its own under a card that has no schedule yet", () => {
    expect(setSuspended(MULTI_FRESH, only(MULTI_FRESH), true)).toBe("q\n?\nr\n!suspended\n");
  });

  it("leaves the note byte-identical after parking and putting back", () => {
    for (const text of [INLINE_HELD, INLINE_FRESH, MULTI_HELD, MULTI_FRESH]) {
      expect(roundTrip(text)).toBe(text);
    }
  });
});

describe("#1926 nextFsrs", () => {
  const TODAY = "2026-11-12";
  const DOC =
    "<!--SR:!fsrs,2026-11-20T00:00:00.000Z,8,8.30,1.00,2,1,0,0,2026-11-12T00:00:00.000Z-->";
  const fsrsCard = (body: string) => only(`#flashcards/x\n\n${body}\n`);

  it("#1926 A1 a new card answered easy writes the doc's own example, field by field", () => {
    const next = nextFsrs(null, "easy", TODAY);
    expect(next).toEqual({
      due: "2026-11-20",
      interval: 8,
      stability: 8.3,
      difficulty: 1,
      state: 2,
      reps: 1,
      lapses: 0,
      steps: 0,
      last: TODAY,
    });
    expect(writeSchedule("#flashcards/x\n\nq::a\n", fsrsCard("q::a"), next)).toBe(
      `#flashcards/x\n\nq::a ${DOC}\n`,
    );
  });

  it("#1926 A1 the schedule is ts-fsrs's at 90 percent, default weights and no fuzz", () => {
    const f = fsrs({ request_retention: 0.9, enable_fuzz: false, enable_short_term: false });
    const now = new Date(`${TODAY}T00:00:00.000Z`);
    for (const [rating, grade] of [
      ["again", 1],
      ["hard", 2],
      ["good", 3],
      ["easy", 4],
    ] as const) {
      const card = f.next(createEmptyCard(now), now, grade).card;
      expect(nextFsrs(null, rating, TODAY)).toMatchObject({
        interval: card.scheduled_days,
        state: card.state,
        steps: card.learning_steps,
      });
    }
  });

  it("#1926 A4 an SM-2 card turns into FSRS by the plugin's sm2ScheduleToFsrsCard rule at its answer", () => {
    const f = fsrs({ request_retention: 0.9, enable_fuzz: false });
    const now = new Date("2026-11-20T00:00:00.000Z");
    // The plugin's rule, by hand: stability the interval, the last answer the due day less it,
    // ease 250 of 130..370 onto difficulty 10..1, log2 of the interval plus one answers.
    const card = f.next(
      {
        due: now,
        stability: 8,
        difficulty: 10 - ((250 - 130) / 240) * 9,
        scheduled_days: 8,
        learning_steps: 0,
        reps: 3,
        lapses: 0,
        state: 2,
        last_review: new Date("2026-11-12T00:00:00.000Z"),
      },
      now,
      3,
    ).card;
    const next = nextFsrs({ due: "2026-11-20", interval: 8, ease: 250 }, "good", "2026-11-20");
    expect(next).toEqual({
      due: card.due.toISOString().slice(0, 10),
      interval: card.scheduled_days,
      stability: Math.round(card.stability * 100) / 100,
      difficulty: Math.round(card.difficulty * 100) / 100,
      state: 2,
      reps: 4,
      lapses: 0,
      steps: 0,
      last: "2026-11-20",
    });
  });

  it("#1926 A4 the ease is clamped to 130..370 before it maps onto difficulty", () => {
    const at = (ease: number) =>
      nextFsrs({ due: TODAY, interval: 10, ease }, "good", TODAY).difficulty;
    expect(at(460)).toBe(at(370));
    expect(at(100)).toBe(at(130));
    expect(at(460)).toBeGreaterThanOrEqual(1);
    expect(at(370)).toBeLessThan(at(250));
  });

  it("#1926 A5 learning and answeredToday read an FSRS card's state and last answer", () => {
    // Learning steps off: every first answer comes due another day, so a card is asked once a day.
    const again = nextFsrs(null, "again", TODAY);
    const good = nextFsrs(null, "good", TODAY);
    const easy = nextFsrs(null, "easy", TODAY);
    const lapsed = nextFsrs(easy, "again", "2026-11-20");
    // A card the plugin left in learning or relearning, with its steps on.
    const steps = [1, 3].map((state) => ({ ...good, state }));
    expect({
      due: [again.due, good.due],
      learning: [again, good, easy, lapsed, ...steps].map((held) => learning(held)),
      today: [again, good, easy].map((held) => answeredToday(held, TODAY)),
      tomorrow: answeredToday(easy, "2026-11-13"),
      lapsed: answeredToday(lapsed, "2026-11-20"),
    }).toEqual({
      due: ["2026-11-13", "2026-11-15"],
      learning: [false, false, false, false, true, true],
      today: ["new", "new", "new"],
      tomorrow: null,
      lapsed: "review",
    });
    // SM-2 keeps its three-number reading.
    expect(answeredToday({ due: "2026-11-13", interval: 1, ease: 250 }, TODAY)).toBe("new");
    expect(learning({ due: TODAY, interval: 0, ease: 250 })).toBe(true);
  });

  it("#1926 a stability that rounds to 0.00, or a plugin reset card, still answers", () => {
    const sunk = { ...nextFsrs(null, "easy", TODAY), stability: 0, difficulty: 0, state: 3 };
    const next = nextFsrs(sunk, "again", "2026-11-20");
    expect(Number.isFinite(next.stability) && next.stability >= 0.01).toBe(true);
    const reset = { ...sunk, state: 0, reps: 0 };
    expect(nextFsrs(reset, "easy", TODAY)).toEqual(nextFsrs(null, "easy", TODAY));
  });

  it("#1926 a thousand random answers write a comment that reads back whole", () => {
    const ratings = ["again", "hard", "good", "easy"] as const;
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    let text = "#flashcards/x\n\nq::a\n";
    let day = TODAY;
    for (let step = 0; step < 1000; step++) {
      const card = only(text);
      const next = nextFsrs(card.held, ratings[Math.floor(random() * 4)] ?? "good", day);
      text = writeSchedule(text, card, next);
      expect(only(text).held).toEqual(next);
      expect(Number.isInteger(next.interval) && next.stability >= 0.01).toBe(true);
      day = shiftDay(day, Math.floor(random() * 40));
    }
  });

  it("#1926 I6 what kasten writes reads back in the plugin's own parser", () => {
    const next = nextFsrs(nextFsrs(null, "again", TODAY), "good", TODAY);
    const written = writeSchedule("#flashcards/x\n\nq::a\n", fsrsCard("q::a"), {
      ...next,
      last: null,
    });
    // obsidian-spaced-repetition's CommentParser.parseScheduleSegment, field for field.
    const body = /<!--SR:(.*)-->/.exec(written)?.[1] ?? "";
    const [segment = ""] = body.split("!").filter((each) => each.trim().length > 0);
    const [algorithm, due, interval, stability, difficulty, state, reps, lapses, steps, last] =
      segment.split(",");
    expect({
      algorithm,
      due: new Date(due ?? "").toISOString(),
      interval: Number.parseFloat(interval ?? ""),
      stability: Number.parseFloat(stability ?? ""),
      difficulty: Number.parseFloat(difficulty ?? ""),
      state: Number.parseInt(state ?? "", 10),
      reps: Number.parseInt(reps ?? "", 10),
      lapses: Number.parseInt(lapses ?? "", 10),
      steps: Number.parseInt(steps ?? "", 10),
      last,
    }).toEqual({
      algorithm: "fsrs",
      due: `${next.due}T00:00:00.000Z`,
      interval: next.interval,
      stability: next.stability,
      difficulty: next.difficulty,
      state: next.state,
      reps: next.reps,
      lapses: next.lapses,
      steps: next.steps,
      last: "-",
    });
  });

  it("#1926 A12 the ts-fsrs and srs-kit licenses ship whole in the bundle's notices", () => {
    const notices = readFileSync("public/THIRD-PARTY-NOTICES.txt", "utf8");
    for (const license of [
      "node_modules/ts-fsrs/LICENSE",
      "node_modules/@open-spaced-repetition/srs-kit/LICENSE",
    ]) {
      expect(notices).toContain(readFileSync(license, "utf8").trim());
    }
    expect(notices).toContain("ts-fsrs 6.0.0");
    expect(notices).toContain("srs-kit 1.0.0");
  });
});

describe("#1926 A11 the due stamp in the browser's zone", () => {
  const zone = process.env.TZ;
  afterEach(() => {
    process.env.TZ = zone;
  });

  it.each([
    ["west", "America/Los_Angeles"],
    ["east", "Pacific/Kiritimati"],
  ])("#1926 A11 a midnight UTC stamp reads as the day kasten meant %s of UTC", (_, place) => {
    process.env.TZ = place;
    // The switch took: this zone is hours off UTC, so local midnight is another instant.
    expect(
      Math.abs(new Date("2026-11-12T00:00:00.000Z").getTimezoneOffset()),
    ).toBeGreaterThanOrEqual(480);
    const text = writeSchedule(
      "#flashcards/x\n\nq::a\n",
      only("#flashcards/x\n\nq::a\n"),
      nextFsrs(null, "easy", "2026-11-12"),
    );
    expect(text).toContain("2026-11-20T00:00:00.000Z");
    const held = only(text).held;
    expect(held).toMatchObject({ due: "2026-11-20", last: "2026-11-12" });
    expect(answeredToday(held, "2026-11-12")).toBe("new");
    expect(only(text).held).toEqual(only(`#flashcards/x\n\nq::a ${text.split("q::a ")[1]}`).held);
  });
});
