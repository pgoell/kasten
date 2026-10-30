/**
 * The sibling of `deck-tag.ts`: `srs.ts` and `review.ts` read a card's line
 * through these, so the rule is written once here.
 */

/** What parks a finished card by hand, written beside its schedule. */
export const SUSPEND_TOKEN = "!suspended";

/**
 * The token at the head of a line or after a space, and whole, so
 * `!suspendedly` is a word. The one false positive is an answer typed to end in it.
 */
const TOKEN = /(?:^|\s)!suspended(?!\S)/g;

/**
 * Where each code span in `text` starts and ends, as `ESCAPES` reads them.
 *
 * A code span is code everywhere (#346, #347): nothing inside one is read as
 * a mark or the token, as the preview draws it verbatim.
 */
function codeSpans(text: string): [number, number][] {
  return [...text.matchAll(ESCAPES)]
    .filter((found) => found[1] !== undefined)
    .map((found) => [found.index, found.index + found[0].length]);
}

/** Whether `at` sits inside one of `spans`. */
function inCode(spans: [number, number][], at: number): boolean {
  return spans.some(([from, to]) => at >= from && at < to);
}

/** The first token outside a code span, or undefined where there is none. */
function token(text: string): RegExpExecArray | undefined {
  const spans = codeSpans(text);
  return [...text.matchAll(TOKEN)].find(
    (found) => !inCode(spans, found.index + found[0].indexOf("!")),
  );
}

/** Whether this text carries the token that parks a card. */
export function suspended(text: string): boolean {
  return token(text) !== undefined;
}

/**
 * Whether the line is the token's own, parking the card above it. Stricter than
 * `suspended`: a line opening with the token is the card's, never part of its answer.
 */
export function parks(line: string | undefined): boolean {
  return line?.trimStart().startsWith(SUSPEND_TOKEN) ?? false;
}

/** The token where it opens a line, with the space after it and not the indent. */
const HEAD_TOKEN = /^([ \t]*)!suspended[ \t]*/;

/**
 * `line` with the token it opens taken off, the indent kept. Unlike `withoutToken`,
 * which eats the space before the token, this eats the space after it.
 */
export function withoutHeadToken(line: string): string {
  return line.replace(HEAD_TOKEN, "$1");
}

/** `text` with the token taken off, which is how a parked card is shown. */
export function withoutToken(text: string): string {
  const found = token(text);
  if (found === undefined) return text.trimEnd();
  return (text.slice(0, found.index) + text.slice(found.index + found[0].length)).trimEnd();
}

/**
 * The comment holding a card's schedule, anywhere on the line. Kept here so both readers
 * strip it alike. The `!` is matched, not assumed, so a comment without it is no card.
 */
export const SR = /<!--SR:!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)-->/;

/**
 * A cloze's schedule, one per number: `<!--SR:c1!…-->`. The name before the `!` keeps it
 * apart from `SR`, which wants the `!` straight after the colon.
 */
export const CLOZE_SR = /<!--SR:c(\d+)!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)-->/;

/**
 * The Anki note and template an import wrote at a card's last line, with a hash of
 * the lines it wrote. Whole, so an answer that only mentions the comment keeps it.
 */
export const ANKI_ID = /<!--anki:\d+:\d+:[0-9a-f]{8}-->/;

/** Every id on a side, with the space before it, for taking them off before it is shown. */
const ANKI_IDS = new RegExp(`[ \\t]*${ANKI_ID.source}`, "g");

/** `text` with the import's ids taken off, which are no part of either side. */
export function withoutAnkiId(text: string): string {
  return text.replace(ANKI_IDS, "");
}

/** Every cloze comment on a line, for taking them all off a side before it is shown. */
const CLOZE_SRS = new RegExp(CLOZE_SR.source, "g");

/**
 * The comment of one number, the `!` after it what keeps `c1` off `c12`.
 *
 * Built per number rather than read off `CLOZE_SR`, because a rating rewrites
 * its own comment and no other, and a replace has to find that one.
 */
export function clozeComment(cloze: number): RegExp {
  return new RegExp(`<!--SR:c${cloze}!(\\d{4}-\\d{2}-\\d{2}),(\\d+),(\\d+)-->`);
}

/**
 * One cloze mark, `{{c1::text}}` or `{{c1::text::hint}}`. No brace inside, so MathJax
 * text survives. Code spans read whole (#346); the lookahead stops backtracking.
 */
const MARK =
  /\{\{c(\d+)::((?:(?=((`+)(?!`)[^{}]*?(?<!`)\4(?!`)|`+|[^{}`]))\3)+?)(?:::((?:(?=((`+)(?!`)[^{}]*?(?<!`)\7(?!`)|`+|[^{}`]))\6)*?))?\}\}/g;

/**
 * Where a mark already read stood: its index between two private-use characters.
 *
 * Private use so no note types one by accident. One that does is read as text
 * unless its index names a mark, and then it reads as that mark.
 */
const HOLE = /(\d+)/;

/** A cloze mark and what it holds, text and marks in the order written. */
interface Mark {
  cloze: number;
  body: Piece[];
  hint: string | undefined;
}

type Piece = string | Mark;

/** `text` cut at its holes, each hole the mark it stands for. */
function pieces(text: string, marks: Mark[]): Piece[] {
  // The split's group puts each index at an odd position, between two texts.
  return text
    .split(HOLE)
    .map((part, at) => (at % 2 === 0 ? part : (marks[Number(part)] ?? `${part}`)));
}

/**
 * The line as text and marks, a mark holding any marks nested in it, read innermost first.
 * Each pass shortens the line, so a deep one takes many passes and never hangs.
 */
function parse(line: string): Piece[] {
  const marks: Mark[] = [];
  let text = line;
  for (;;) {
    // Per pass, as the holes a pass leaves move every span after them.
    const spans = codeSpans(text);
    const read = text.replace(
      MARK,
      (
        whole: string,
        number: string,
        body: string,
        _item: string,
        _ticks: string | undefined,
        hint: string | undefined,
        _hintItem: string | undefined,
        _hintTicks: string | undefined,
        at: number,
      ) => {
        // A mark opened inside a code span is code, and stays as written.
        if (inCode(spans, at)) return whole;
        marks.push({ cloze: Number(number), body: pieces(body, marks), hint });
        return `${marks.length - 1}`;
      },
    );
    if (read === text) return pieces(text, marks);
    text = read;
  }
}

/** The pieces as their plain text, every mark its text and no hint. */
function plain(found: Piece[]): string {
  return found.map((piece) => (typeof piece === "string" ? piece : plain(piece.body))).join("");
}

/** Every mark at every depth, for the numbers a line asks. */
function everyMark(found: Piece[]): Mark[] {
  return found.flatMap((piece) =>
    typeof piece === "string" ? [] : [piece, ...everyMark(piece.body)],
  );
}

/**
 * The outermost marks of one number, a mark inside one of them being part of its text.
 *
 * Outermost because Anki hides the whole span of the number asked, so a mark of
 * the same number inside it is hidden with it rather than asked again.
 */
function asked(found: Piece[], cloze: number): Mark[] {
  return found.flatMap((piece) => {
    if (typeof piece === "string") return [];
    return piece.cloze === cloze ? [piece] : asked(piece.body, cloze);
  });
}

/**
 * The numbers the line's marks carry, ascending and each once. The session addresses a card
 * by its ordinal in its note, so the order must match on every read.
 */
export function clozeNumbers(line: string): number[] {
  const found = new Set(everyMark(parse(line)).map((mark) => mark.cloze));
  return [...found].sort((one, two) => one - two);
}

/** Whether the line is a cloze, which it is before it is anything else. */
export function holdsCloze(line: string | undefined): boolean {
  return line !== undefined && clozeNumbers(line).length > 0;
}

/** `line` with every schedule comment taken off, plain and labelled, the token and the id. */
function bare(line: string): string {
  return withoutToken(withoutAnkiId(line.replace(CLOZE_SRS, "").replace(SR, ""))).trim();
}

/**
 * `line` with one number's marks drawn by `hidden` and every other number's as its text.
 *
 * A mark of another number is opened and drawn in turn, so c2 inside c1 is
 * still asked on c2's card; one of this number is drawn whole, its text plain.
 */
function drawn(line: string, cloze: number, hidden: (text: string, hint?: string) => string) {
  const draw = (found: Piece[]): string =>
    found
      .map((piece) => {
        if (typeof piece === "string") return piece;
        return piece.cloze === cloze ? hidden(plain(piece.body), piece.hint) : draw(piece.body);
      })
      .join("");
  return draw(parse(bare(line)));
}

/**
 * The question this number asks: its text hidden as `[...]`, or as `[hint]`.
 *
 * The brackets escaped, because a front is markdown and the preview reads a
 * bare `[...]` as a link, hiding the brackets that make it read as a blank.
 */
export function clozeQuestion(line: string, cloze: number): string {
  // `||` and not `??`: an empty hint is no hint.
  return drawn(line, cloze, (_, hint) => `\\[${hint || "..."}\\]`);
}

/** The line as its sentence, every mark its plain text, which names a cloze as a whole. */
export function clozePlain(line: string): string {
  return colons(drawn(line, 0, (text) => text));
}

/**
 * What `colons` and `unescaped` read, leftmost first, in one pass so an escape pair is
 * read before what follows it. A code span closes on a backtick run of its own length.
 */
const ESCAPES = /\\&#58;|\\[\s\S]|(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)|`+|&#58;/g;

/** An escape markdown reads, a backslash before ASCII punctuation. */
const ESCAPED = /^\\[!-/:-@[-`{-~]$/;

/**
 * `text` with `&#58;` read as the colon it stands for, and `\&#58;` as the text `&#58;`.
 * The import writes it so a typed `::` cannot split a cloze at its hint (#335, #340).
 */
export function colons(text: string): string {
  return text.replace(ESCAPES, (found) =>
    found === "&#58;" ? ":" : found === "\\&#58;" ? "&#58;" : found,
  );
}

/**
 * A card side `colons` has read, with markdown's escapes taken off, as text.
 * Not decoded again here, so a second pass cannot read the text `&#58;` as a colon.
 */
export function unescaped(text: string): string {
  return text.replace(ESCAPES, (found) => (ESCAPED.test(found) ? found.slice(1) : found));
}

/** The answer: the whole line, with this number's text highlighted. */
export function clozeAnswer(line: string, cloze: number): string {
  return drawn(line, cloze, (text) => `==${text}==`);
}

/** What typing the answer is compared against: this number's texts, joined. */
export function clozeTarget(line: string, cloze: number): string {
  return asked(parse(line), cloze)
    .map((mark) => plain(mark.body))
    .join(", ");
}

/** The two halves of a card written on one line, or null where the line is no card. */
export interface Divided {
  front: string;
  back: string;
}

/**
 * A card written on one line, split at its first `::`. The schedule, token and Anki id
 * come off the back first. An empty back stays empty, not null: a question with no answer is a card waiting.
 */
export function divide(line: string): Divided | null {
  const spans = codeSpans(line);
  const at = [...line.matchAll(/::/g)].find((found) => !inCode(spans, found.index))?.index;
  if (at === undefined) return null;
  return {
    front: withoutAnkiId(line.slice(0, at)).trim(),
    back: withoutToken(withoutAnkiId(line.slice(at + 2).replace(SR, ""))).trim(),
  };
}
