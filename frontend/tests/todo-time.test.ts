import {
  formatDuration,
  formatSession,
  minutesBetween,
  parseDuration,
  parseSession,
} from "@/lib/todo-time";

const CLOSED = "- 09:12-10:32 wire up the pane [[projects/kasten]] kt-3f9a2c";
const OPEN = "- 14:03-      wire up the pane [[projects/kasten]] kt-3f9a2c";

describe("parseSession", () => {
  it("reads a closed line into its times, its words, its link and its id", () => {
    expect(parseSession(CLOSED)).toEqual({
      start: "09:12",
      end: "10:32",
      text: "wire up the pane",
      link: "projects/kasten",
      id: "kt-3f9a2c",
    });
  });

  it("leaves the end off a line that is still running", () => {
    expect(parseSession(OPEN)?.end).toBeUndefined();
    expect(parseSession(OPEN)?.start).toBe("14:03");
  });

  it("leaves the link off a todo living in the note being written", () => {
    const line = "- 11:00-11:25 call the dentist kt-4c2d11";

    expect(parseSession(line)).toEqual({
      start: "11:00",
      end: "11:25",
      text: "call the dentist",
      link: undefined,
      id: "kt-4c2d11",
    });
  });

  it("reads a line at any indent", () => {
    expect(parseSession("  - 08:00-      a part")?.start).toBe("08:00");
  });

  it("answers null for a line that is not a session", () => {
    for (const line of [
      "- [ ] buy milk",
      "- ✅ 2026-08-10 read the spec kt-000001",
      "- 9:12- one digit hour",
      "- 09:12 no dash at all",
      "",
    ]) {
      expect(parseSession(line)).toBeNull();
    }
  });
});

describe("formatSession", () => {
  it("writes a parsed line back byte for byte, closed and open alike", () => {
    for (const line of [CLOSED, OPEN, "- 11:00-11:25 call the dentist kt-4c2d11"]) {
      const session = parseSession(line);
      expect(session).not.toBeNull();
      expect(session === null ? "" : formatSession(session)).toBe(line);
    }
  });

  it("puts the words of an open and a closed line at the same column", () => {
    const closed = formatSession({ start: "09:12", end: "10:32", text: "read the spec" });
    const open = formatSession({ start: "09:12", text: "read the spec" });

    expect(open.indexOf("read")).toBe(closed.indexOf("read"));
  });
});

describe("parseDuration", () => {
  it("reads every spelling kasten writes", () => {
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("1h20m")).toBe(80);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("0m")).toBe(0);
  });

  it("answers null for what it cannot read", () => {
    for (const text of ["2", "1h20", "", "two hours", "1m20h"]) {
      expect(parseDuration(text)).toBeNull();
    }
  });
});

describe("formatDuration", () => {
  it("writes minutes under an hour, whole hours bare, and both otherwise", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(80)).toBe("1h20m");
    // Written rather than dropped, so the log's own total is always on the line.
    expect(formatDuration(0)).toBe("0m");
  });

  it("reads back to the minutes it means", () => {
    for (const minutes of [0, 1, 45, 60, 80, 120, 599]) {
      expect(parseDuration(formatDuration(minutes))).toBe(minutes);
    }
  });
});

describe("minutesBetween", () => {
  it("counts the minutes from one clock to the other", () => {
    expect(minutesBetween("09:12", "10:32")).toBe(80);
    expect(minutesBetween("23:50", "23:59")).toBe(9);
    expect(minutesBetween("14:03", "14:03")).toBe(0);
  });

  it("floors an end typed in backwards at zero", () => {
    expect(minutesBetween("10:00", "09:00")).toBe(0);
  });
});
