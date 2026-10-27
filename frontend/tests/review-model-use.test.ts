import type { ModelUseLine } from "@/lib/review/review-api";
import {
  costWords,
  monthUse,
  projectUse,
  tokenWords,
  unpricedTokens,
} from "@/lib/review/review-model-use";

function line(over: Partial<ModelUseLine>): ModelUseLine {
  return {
    day: "2026-10-03",
    model: "claude-opus-5-5",
    project: "kasten",
    input: 0,
    output: 0,
    cache_write: 0,
    cache_read: 0,
    cost: 0,
    unpriced: 0,
    ...over,
  };
}

describe("the model use sums", () => {
  it("#808 A4 monthUse adds each month's tokens and priced cost, January first, and leaves out other years", () => {
    const months = monthUse(
      [
        line({
          day: "2026-02-11",
          input: 1000,
          output: 2000,
          cache_write: 3000,
          cache_read: 4000,
          cost: 4.1,
        }),
        line({ day: "2026-02-12", input: 500, output: 500, cost: 0.5 }),
        line({ day: "2026-10-04", input: 300000, output: 40000, cost: null }),
        line({ day: "2025-12-31", input: 99, cost: 1 }),
      ],
      2026,
    );

    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ tokens: 0, cost: null });
    expect(months[1]?.tokens).toBe(11000);
    expect(months[1]?.cost).toBeCloseTo(4.6);
    // A month whose only line has no price has no cost, and no zero.
    expect(months[9]).toEqual({ tokens: 340000, cost: null });
  });

  it("#808 A4 projectUse sorts by cost, then by tokens, and a project with no priced line has no cost", () => {
    const rows = projectUse([
      line({ project: "scratch", input: 100, cost: null }),
      line({ project: "blattwerk", input: 1000, cost: 0.5 }),
      line({ project: "kasten", input: 10, cost: 4 }),
      line({ project: "alpha", input: 5000000, cost: 0.5 }),
    ]);

    expect(rows.map((row) => row.project)).toEqual(["kasten", "alpha", "blattwerk", "scratch"]);
    expect(rows[3]).toEqual({ project: "scratch", tokens: 100, cost: null });
  });

  it("#808 I1 unpricedTokens counts all four counts of a line with no cost, and only the unpriced tokens of a partly priced one", () => {
    expect(
      unpricedTokens([
        line({ input: 300000, output: 40000, cost: null }),
        line({ input: 10, output: 20, cache_write: 30, cache_read: 40, cost: 0.01, unpriced: 60 }),
        line({ input: 1, cost: 1, unpriced: 0 }),
      ]),
    ).toBe(340060);
  });

  it("#808 A4 tokenWords and costWords write the sizes the review shows", () => {
    expect(tokenWords(912)).toBe("912");
    expect(tokenWords(340_100)).toBe("340k");
    expect(tokenWords(1_234_000)).toBe("1.2M");
    expect(tokenWords(999_600)).toBe("1M");
    expect(costWords(4.1)).toBe("$4.10");
    expect(costWords(1204.55)).toBe("$1,204.55");
    expect(costWords(0)).toBe("$0.00");
  });

  it("#808 A4 tokenWords writes billions as B from 999.5M up, so a year of cache reads never reads as thousands of M", () => {
    expect(tokenWords(999_000_000)).toBe("999M");
    expect(tokenWords(999_600_000)).toBe("1B");
    expect(tokenWords(12_300_000_000)).toBe("12.3B");
  });

  it("#808 A4 tokenWords drops a trailing .0", () => {
    expect(tokenWords(700_000_000)).toBe("700M");
    expect(tokenWords(2_000_000_000)).toBe("2B");
    expect(tokenWords(1_200_000_000)).toBe("1.2B");
  });
});
