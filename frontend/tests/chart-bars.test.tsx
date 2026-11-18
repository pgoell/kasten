import { cleanup, render } from "@testing-library/react";
import { Bars } from "@/components/charts";

afterEach(cleanup);

function bars(amounts: number[]) {
  const { container } = render(
    <Bars
      label="bars"
      points={amounts.map((amount, index) => ({ index, amount }))}
      slots={amounts.length}
    />,
  );
  const rects = [...container.querySelectorAll("rect")].map((rect) => ({
    y: Number(rect.getAttribute("y")),
    height: Number(rect.getAttribute("height")),
  }));
  return { rects, zero: container.querySelector(".log-chart-zero-line") };
}

test("bars of positive values stand on the bottom edge, with no zero line", () => {
  const { rects, zero } = bars([40, 80]);
  expect(rects).toEqual([
    { y: 40, height: 40 },
    { y: 0, height: 80 },
  ]);
  expect(zero).toBeNull();
});

test("a negative value hangs below a zero line instead of vanishing", () => {
  const { rects, zero } = bars([60, -20]);
  expect(zero?.getAttribute("y1")).toBe("60");
  expect(rects).toEqual([
    { y: 0, height: 60 },
    { y: 60, height: 20 },
  ]);
});
