/**
 * What a table cell holds, read off its text, for the way the table draws it.
 *
 * Pure functions on the text the cell shows, so the drawing and the tests read
 * one rule. A column is numeric when every cell that says something is a number,
 * which lets a column of words with one stray number stay words.
 */

/** A sign, the true minus included, since a table copied out of a spreadsheet has it. */
const SIGN = "[+\\-\u2212]?";
const CURRENCY = "[$€£¥]";
/**
 * Digits, grouped in threes by a comma, a point, an apostrophe or a space, with
 * at most one decimal separator after them. A date or a version has two separators
 * and its groups are not threes, so it is not a number.
 */
const DIGITS = "(?:\\d+(?:[.,'  ]\\d{3})+|\\d+)(?:[.,]\\d+)?";
const NUMBER = new RegExp(`^${SIGN}\\s?${CURRENCY}?\\s?${DIGITS}\\s?${CURRENCY}?\\s?%?$`);

/** A cell that is only dashes stands for nothing, as an empty cell does. */
const DASHES = /^[-‒–—]+$/;

/** Whether the text is only dashes, the writer's stand-in for nothing. */
export function isDashes(text: string): boolean {
  return DASHES.test(text.trim());
}

/** Whether a cell says nothing: empty, or dashes the writer put in its place. */
export function isBlank(text: string): boolean {
  return text.trim() === "" || isDashes(text);
}

/** Whether the text is a number, with its sign, currency and percent if it has them. */
export function isNumber(text: string): boolean {
  return NUMBER.test(text.trim());
}

/**
 * Whether a column of body cells is numeric: every cell that says something is
 * a number, and at least one of them says something.
 */
export function isNumericColumn(texts: string[]): boolean {
  const filled = texts.filter((text) => !isBlank(text));
  return filled.length > 0 && filled.every(isNumber);
}

/**
 * Whether one token reads as a code name, such as `WH-07` or `DE_BER_3`.
 *
 * A word has no digits and a number has no letters, so neither is code. A date
 * has dashes and digits only, and is left as it is for the same reason.
 */
export function isCodeToken(text: string): boolean {
  // Three characters or fewer is too short to name anything, `Q3` or `3rd` among them.
  if (text.length < 4 || /\s/.test(text)) return false;
  if (text.includes("_")) return true;
  return /[A-Za-z]/.test(text) && /\d/.test(text);
}
