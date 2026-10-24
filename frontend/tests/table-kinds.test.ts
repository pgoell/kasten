import { isBlank, isCodeToken, isNumber, isNumericColumn } from "@/lib/table-kinds";

// Each case has its own `it`, so a red one names the text that broke the rule.

describe("table kinds", () => {
  it("#792 I7 a plus sign and a minus sign, the true minus included, are part of a number", () => {
    expect(isNumber("+3")).toBe(true);
    expect(isNumber("-3")).toBe(true);
    expect(isNumber("−3")).toBe(true);
  });

  it("#792 I7 a currency before or after the digits is part of a number", () => {
    expect(isNumber("$5")).toBe(true);
    expect(isNumber("€ 5")).toBe(true);
    expect(isNumber("5 £")).toBe(true);
    expect(isNumber("¥1,000")).toBe(true);
  });

  it("#792 I7 a unit after the digits makes a cell no number", () => {
    expect(isNumber("5 kg")).toBe(false);
    expect(isNumber("5 apples")).toBe(false);
  });

  it("#792 I7 a decimal point or comma and a thousands separator are part of a number", () => {
    expect(isNumber("12.5")).toBe(true);
    expect(isNumber("1,234.5")).toBe(true);
    expect(isNumber("1.234,5")).toBe(true);
    expect(isNumber("1'234'567")).toBe(true);
    expect(isNumber("1 234")).toBe(true);
    expect(isNumber("1 234 567")).toBe(true);
  });

  it("#792 I7 a percent is part of a number, with or without a space before it", () => {
    expect(isNumber("12%")).toBe(true);
    expect(isNumber("12 %")).toBe(true);
  });

  it("#792 I7 a column of words with one number in it is not numeric", () => {
    expect(isNumericColumn(["tea", "3", "cake"])).toBe(false);
  });

  it("#792 I7 empty and dash cells do not count against a numeric column", () => {
    expect(isNumericColumn(["1", "", "‒", "-", "2"])).toBe(true);
  });

  it("#792 I7 a column of only empty cells is not numeric", () => {
    expect(isNumericColumn(["", "-"])).toBe(false);
  });

  it("#792 I7 a dash cell says nothing, as an empty one does", () => {
    expect(isBlank("--")).toBe(true);
    expect(isBlank("  ")).toBe(true);
    expect(isBlank("2")).toBe(false);
  });

  it("#792 A6 a code name with a dash and digits is code", () => {
    expect(isCodeToken("WH-07")).toBe(true);
  });

  it("#792 A6 a code name with dashes between words and a digit is code", () => {
    expect(isCodeToken("us-east-1")).toBe(true);
  });

  it("#792 A6 a token with an underscore is code", () => {
    expect(isCodeToken("DE_BER_3")).toBe(true);
  });

  it("#792 A6 a token of letters and digits run together is code", () => {
    expect(isCodeToken("a1b2c3")).toBe(true);
  });

  it("#792 A6 a plain word is not code", () => {
    expect(isCodeToken("tea")).toBe(false);
  });

  it("#792 A6 a number is not code", () => {
    expect(isCodeToken("1,234")).toBe(false);
  });

  it("#792 A6 a date is not code", () => {
    expect(isCodeToken("2026-10-24")).toBe(false);
  });

  it("#792 A6 a text of several words is not code, even with a digit in it", () => {
    expect(isCodeToken("two words a1")).toBe(false);
  });

  it("#792 I7 a date written with two dots is not a number", () => {
    expect(isNumber("24.10.2026")).toBe(false);
  });

  it("#792 I7 a version with two dots is not a number", () => {
    expect(isNumber("1.2.3")).toBe(false);
  });

  it("#792 I7 two digits split by a space are not a number", () => {
    expect(isNumber("1 2")).toBe(false);
  });

  it("#792 A6 a two-character token is not code", () => {
    expect(isCodeToken("Q3")).toBe(false);
  });

  it("#792 A6 a version-like token of two characters is not code", () => {
    expect(isCodeToken("v2")).toBe(false);
  });

  it("#792 A6 an ordinal of three characters is not code", () => {
    expect(isCodeToken("3rd")).toBe(false);
  });
});
