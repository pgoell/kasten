import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { lineSuggestions, shorthandSuggestions, todoCompletions } from "@/lib/todo-suggest";

/** A Monday, so `readDate` sends `monday` a week out and `tomorrow` to Tuesday. */
const TODAY = "2026-08-10";

/** Every field a bare todo can still be given, in the order the line writes them. */
const ALL = [
  "due",
  "scheduled",
  "start",
  "highest",
  "high",
  "medium",
  "low",
  "lowest",
  "daily",
  "weekly",
  "monthly",
  "estimate",
];

function names(before: string, prompted = false): string[] | null {
  const found = lineSuggestions(before, TODAY, prompted);
  return found === null ? null : found.options.map(({ name }) => name);
}

describe("lineSuggestions", () => {
  it("offers every field the line has not got, once a colon opens the list", () => {
    const found = lineSuggestions("- [ ] call bob :", TODAY);

    expect(found?.options.map(({ name }) => name)).toEqual(ALL);
    // From the colon, so what goes in takes the trigger with it.
    expect(found?.from).toBe(15);
  });

  it("leaves out a field the line already carries", () => {
    expect(names("- [ ] call bob 📅 2026-08-14 ⏫ :")).toEqual([
      "scheduled",
      "start",
      "daily",
      "weekly",
      "monthly",
      "estimate",
    ]);
  });

  it("narrows the list to what has been typed", () => {
    expect(names("- [ ] call bob :sc")).toEqual(["scheduled"]);
  });

  it("answers nothing where the word names no field", () => {
    expect(names("- [ ] call bob :zz")).toBeNull();
  });

  it("says nothing on a line that is not a todo", () => {
    expect(names("call bob :")).toBeNull();
  });

  it("stays quiet on a todo line nobody asked", () => {
    expect(names("- [ ] call bob ")).toBeNull();
  });

  it("offers the fields with no colon when the caller asks for them", () => {
    const found = lineSuggestions("- [ ] call bob", TODAY, true);

    expect(found?.from).toBe(14);
    // The line ends on a word, so what goes in opens with the space it needs.
    expect(found?.options[0]?.text).toBe(" 📅 ");
  });

  it("writes one space where the line already ends in one", () => {
    expect(lineSuggestions("- [ ] call bob ", TODAY, true)?.options[0]?.text).toBe("📅 ");
  });

  it("offers the days once a date marker is written", () => {
    const found = lineSuggestions("- [ ] call bob 📅", TODAY);

    expect(found?.options.slice(0, 3)).toEqual([
      { name: "today", hint: "2026-08-10", text: " 2026-08-10" },
      { name: "tomorrow", hint: "2026-08-11", text: " 2026-08-11" },
      // A weekday names the next one, and today's own is a week out.
      { name: "monday", hint: "2026-08-17", text: " 2026-08-17" },
    ]);
    // Right after the marker, so the spaces between are the answer's to write.
    expect(found?.from).toBe(17);
  });

  it("narrows the days too", () => {
    expect(names("- [ ] call bob 📅 tom")).toEqual(["tomorrow"]);
  });

  it("replaces whatever sits between the marker and the day", () => {
    const found = lineSuggestions("- [ ] call bob 📅   ", TODAY);

    expect(found?.from).toBe(17);
    expect(found?.options[0]?.text).toBe(" 2026-08-10");
  });

  it("goes back to the fields once the date is written", () => {
    expect(names("- [ ] call bob 📅 2026-08-14", true)).not.toContain("today");
  });

  it("offers durations after the estimate marker, and nothing after a written one", () => {
    expect(names("- [ ] call bob ⏲")).toEqual(["15m", "30m", "45m", "1h", "2h", "4h"]);
    expect(names("- [ ] call bob ⏲ 45m", true)).not.toContain("30m");
  });

  it("offers the scheduled date its own days", () => {
    expect(lineSuggestions("- [ ] call bob ⏳", TODAY)?.options[0]?.text).toBe(" 2026-08-10");
  });
});

describe("shorthandSuggestions", () => {
  it("offers the same fields in the shorthand's own spelling", () => {
    const found = shorthandSuggestions("call bob", TODAY);

    expect(found?.options.map(({ name }) => name)).toEqual(ALL);
    expect(found?.options.map(({ text }) => text).slice(0, 5)).toEqual([
      " due:",
      " sched:",
      " start:",
      " !highest",
      " !high",
    ]);
    expect(found?.from).toBe(8);
  });

  it("leaves out a field the input already sets, however it was spelled", () => {
    expect(
      shorthandSuggestions("call bob due:tomorrow !high", TODAY)?.options.map((o) => o.name),
    ).toEqual(["scheduled", "start", "daily", "weekly", "monthly", "estimate"]);
  });

  it("offers the days after a term that takes one, with no space before them", () => {
    const found = shorthandSuggestions("call bob due:", TODAY);

    expect(found?.from).toBe(13);
    expect(found?.options[1]).toEqual({
      name: "tomorrow",
      hint: "2026-08-11",
      text: "2026-08-11",
    });
  });

  it("narrows the days, and the durations after est:", () => {
    expect(shorthandSuggestions("call bob due:fri", TODAY)?.options.map((o) => o.text)).toEqual([
      "2026-08-14",
    ]);
    expect(shorthandSuggestions("write it est:", TODAY)?.options[0]?.text).toBe("15m");
  });

  it("writes no second space where the input ends in one", () => {
    expect(shorthandSuggestions("call bob ", TODAY)?.options[0]?.text).toBe("due:");
    expect(shorthandSuggestions("", TODAY)?.options[0]?.text).toBe("due:");
  });
});

function complete(doc: string, explicit = false): ReturnType<typeof todoCompletions> {
  const state = EditorState.create({ doc });
  return todoCompletions(new CompletionContext(state, doc.length, explicit));
}

describe("todoCompletions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 10, 9, 30));
  });

  afterEach(() => vi.useRealTimers());

  it("completes the field the colon opened, taking the colon with it", () => {
    const result = complete("# today\n\n- [ ] call bob :du");

    expect(result?.options).toEqual([{ label: "due", detail: "📅", apply: "📅 " }]);
    // The offset into the document, not into the line.
    expect(result?.from).toBe("# today\n\n- [ ] call bob ".length);
  });

  it("reads today off the clock, so the days it offers are real ones", () => {
    const result = complete("- [ ] call bob 📅");

    expect(result?.options[0]).toEqual({
      label: "today",
      detail: "2026-08-10",
      apply: " 2026-08-10",
    });
  });

  it("offers nothing mid-sentence, and everything when asked", () => {
    expect(complete("- [ ] call bob")).toBeNull();
    expect(complete("- [ ] call bob", true)?.options).toHaveLength(ALL.length);
  });

  it("keeps out of prose", () => {
    expect(complete("a note: about bob :", true)).toBeNull();
  });
});
