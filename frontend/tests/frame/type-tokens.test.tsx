/**
 * The type scale on rendered text (#798, Y1 and Y2). Each probe is a span with
 * the utility class under test, measured in px in a real browser.
 */

import "@/styles/app.css";

/**
 * The computed type of a probe span with the given classes. Copied out before
 * the span goes, since a live style declaration reads empty once its element is gone.
 */
function probe(classes: string, text: string) {
  const span = document.body.appendChild(document.createElement("span"));
  span.className = classes;
  span.textContent = text;
  const style = getComputedStyle(span);
  const values = {
    fontSize: style.fontSize,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
  };
  span.remove();
  return values;
}

it("text-k-64 tracks -0.018em and leads at 1.04", () => {
  const style = probe("text-k-64", "Ag");
  expect(parseFloat(style.letterSpacing)).toBeCloseTo(-1.152, 3);
  expect(parseFloat(style.lineHeight)).toBeCloseTo(66.56, 2);
  expect(parseFloat(style.fontSize)).toBeCloseTo(64, 3);
});

it("text-k-13 tracks 0.006em", () => {
  const style = probe("text-k-13", "Ag");
  expect(parseFloat(style.letterSpacing)).toBeCloseTo(0.078, 3);
  expect(parseFloat(style.fontSize)).toBeCloseTo(13, 3);
});

it("tracking-k-kbd on 13 px text is 0.02em", () => {
  const style = probe("text-k-13 tracking-k-kbd", "Ag");
  expect(parseFloat(style.letterSpacing)).toBeCloseTo(0.26, 3);
  expect(parseFloat(style.fontSize)).toBeCloseTo(13, 3);
});
