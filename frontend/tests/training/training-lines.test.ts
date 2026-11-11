// @vitest-environment node
import { describe, expect, it } from "vitest";
import cases from "@/lib/log/cases/training-cases.json";
import { e1rm, parseTrainingLine } from "@/lib/log/training/training-lines";

interface Row {
  id: string;
  line: string;
  entry: unknown;
}

describe("parseTrainingLine, against the shared cases", () => {
  it.each((cases as Row[]).map((row) => [row.id, row] as const))("%s", (_id, row) => {
    expect(parseTrainingLine(row.line)).toEqual(row.entry);
  });
});

describe("e1rm", () => {
  it("takes the best set, to a tenth", () => {
    expect(e1rm(80, [8, 7, 7])).toBe(101.3);
  });

  it("gives none without a set of ten reps or fewer", () => {
    expect(e1rm(60, [11, 12])).toBeUndefined();
  });
});
