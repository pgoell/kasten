import { changeFor, optionsFor } from "@/components/todo/view/pick/date-pick";
import { dayHeading } from "@/lib/todo/view/rows/upcoming";
import { groupsOf, upcomingWeek } from "@/lib/todo/view/rows/view-rows";
import { row, TODAY } from "./rows";

// TODAY is Sunday 22 Nov 2026.
const ROWS = [
  row("kt-000001", "ship the release", { planned: "2026-11-23", estimate: 90 }),
  row("kt-000002", "call the landlord", { planned: "2026-11-23", estimate: 30 }),
  row("kt-000003", "check the numbers", { parent_id: "kt-000004" }),
  row("kt-000004", "draft the offer", { planned: "2026-11-27", due: "2026-11-27", due_hard: true }),
  row("kt-000005", "buy paint", { planned: "2026-12-02" }),
  row("kt-000006", "far off", { planned: "2026-12-20" }),
  row("kt-000007", "done already", { planned: "2026-11-24", state: "done" }),
  // A soft due date is the store's fallback, not a day the todo was given.
  row("kt-000008", "undated", { due: "2026-11-25" }),
  // Held past its planned day, so Upcoming leaves it out, strip included.
  row("kt-000010", "held", {
    planned: "2026-11-24",
    hold_until: "2026-11-25",
    due: "2026-11-24",
    due_hard: true,
  }),
];

describe("the Upcoming tab", () => {
  it("groups the week ahead by day, then the week after, each with its time and deadlines", () => {
    const groups = groupsOf(ROWS, { tab: "upcoming", by: "day", today: TODAY });
    expect(
      groups.map((group) => [
        group.label,
        group.sub,
        group.lines.length,
        group.minutes,
        group.deadlines,
      ]),
    ).toEqual([
      ["Tomorrow", "Mon 23 Nov", 2, 120, 0],
      ["Friday", "Fri 27 Nov", 2, 0, 1],
      ["The week after", "30 Nov to 6 Dec", 1, 0, 0],
    ]);
    expect(groups[1]?.lines.map((line) => [line.row.words, line.depth])).toEqual([
      ["draft the offer", 0],
      ["check the numbers", 1],
    ]);
    expect(groups[0]?.day).toBe("2026-11-23");
  });

  it("draws seven days with how full each is and where a hard due date falls", () => {
    const week = upcomingWeek(ROWS, TODAY);
    expect(week.map((day) => day.day)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(week[0]).toMatchObject({ count: 2, minutes: 120, deadline: false });
    expect(week[0]?.load).toBeCloseTo(120 / 360);
    expect(week[1]).toMatchObject({ count: 0, load: 0, deadline: false });
    expect(week[4]).toMatchObject({ count: 2, deadline: true });
  });

  it("names a day group by its weekday, tomorrow by name", () => {
    expect(dayHeading("2026-11-23", TODAY).label).toBe("Tomorrow");
    expect(dayHeading("2026-11-25", TODAY)).toEqual({ label: "Wednesday", sub: "Wed 25 Nov" });
  });
});

describe("the date popover", () => {
  it("offers the quick days, narrowed by what is typed, and the day a word names", () => {
    expect(optionsFor("", TODAY).map((option) => [option.label, option.day])).toEqual([
      ["Today", TODAY],
      ["Tomorrow", "2026-11-23"],
      ["Next week", "2026-11-23"],
      ["No day", null],
    ]);
    expect(optionsFor("wed", TODAY).map((option) => [option.label, option.day])).toEqual([
      ["Wednesday", "2026-11-25"],
    ]);
    expect(optionsFor("to", TODAY).map((option) => option.label)).toEqual(["Today", "Tomorrow"]);
  });

  it("makes a picked due date hard and a cleared one soft", () => {
    expect(changeFor("due", "2026-11-27")).toEqual({ due: "2026-11-27", due_hard: true });
    expect(changeFor("due", null)).toEqual({ due: null, due_hard: false });
    expect(changeFor("hold_until", "2026-12-01")).toEqual({ hold_until: "2026-12-01" });
  });
});
