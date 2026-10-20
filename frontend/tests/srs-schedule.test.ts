import { sameAnswer } from "@/lib/card-text";
import { setSuspended, writeSchedule } from "@/lib/card-write";
import {
  nextSchedule,
  readNoteSchedule,
  readNoteSuspended,
  writeNoteSchedule,
  writeNoteSuspended,
} from "@/lib/srs-schedule";
import { NOTE, only } from "./srs-fixture";

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
