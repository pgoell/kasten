/**
 * What makes a line a card the sitting will ask.
 *
 * The sibling of `deck-tag.ts`. `srs.ts` parses with these, and `review.ts`
 * picks the notes holding a parked line with them, so a rule about a card's
 * line is written once here.
 */

/** Which lines sit inside a fenced code block, so `std::vector` is not a card. */
export function fences(lines: string[]): boolean[] {
  let inside = false;
  return lines.map((line) => {
    if (line.trimStart().startsWith("```")) {
      inside = !inside;
      // The fence itself is never a card either way.
      return true;
    }
    return inside;
  });
}

/** What parks a finished card by hand, written beside its schedule. */
export const SUSPEND_TOKEN = "!suspended";

/**
 * The token, at the head of a line or after a space, and whole.
 *
 * Whole so `!suspendedly` is a word and not a marker, and after a space so a
 * card asking what the token means keeps its answer. An answer that really does
 * end in the literal text is the one false positive left, and it is one the
 * author typed on purpose.
 */
const TOKEN = /(?:^|\s)!suspended(?!\S)/;

/** Whether this text carries the token that parks a card. */
export function suspended(text: string): boolean {
  return TOKEN.test(text);
}

/**
 * Whether the line is the token's own, which parks the card written above it.
 *
 * Stricter than `suspended`, and a different question. A card written over
 * several lines carries the token at the head of the line under its back, so a
 * line that opens with it belongs to that card and is no part of the answer.
 */
export function parks(line: string | undefined): boolean {
  return line?.trimStart().startsWith(SUSPEND_TOKEN) ?? false;
}

/** The token where it opens a line, with the space after it and not the indent. */
const HEAD_TOKEN = /^([ \t]*)!suspended[ \t]*/;

/**
 * `line` with the token it opens taken off, the indent kept.
 *
 * The twin of `withoutToken` and a different job. That one takes the token out
 * of an answer, so it eats the space before it; this one takes it off the line
 * it owns, so it eats the space after it and what is left is the schedule, or
 * nothing at all.
 */
export function withoutHeadToken(line: string): string {
  return line.replace(HEAD_TOKEN, "$1");
}

/** `text` with the token taken off, which is how a parked card is shown. */
export function withoutToken(text: string): string {
  return text.replace(TOKEN, "").trimEnd();
}

/**
 * The comment holding a card's schedule, wherever on the line it sits.
 *
 * Here rather than in `srs.ts` because both readers have to take it off a back
 * before showing one, and two copies of this expression is two chances to
 * disagree about what a card's answer is. `!` is obsidian-spaced-repetition's
 * and is matched rather than assumed, so a comment written without one is left
 * alone instead of read as a card nobody has answered.
 */
export const SR = /<!--SR:!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)-->/;

/**
 * A cloze's schedule, one per number and named by it: `<!--SR:c1!…-->`.
 *
 * The name sits between the colon and the `!`, which is what keeps the two
 * comments apart in both directions: `SR` wants the `!` straight after the
 * colon, and this wants a number before it. A cloze line can then carry its
 * numbers' comments in any order, and a plain card beside it never reads one.
 */
export const CLOZE_SR = /<!--SR:c(\d+)!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)-->/;

/**
 * The Anki note and template an imported card came from, and a hash of the lines
 * the import wrote: `<!--anki:NID:ORD:HHHHHHHH-->`.
 *
 * Written by the import at the end of the card's last line, so a second import
 * of the same deck finds the card to update rather than adding it again, and
 * leaves alone one edited since. Whole, digits and eight lowercase hex only, so
 * an answer that merely mentions the comment keeps it.
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
 * One cloze mark, `{{c1::text}}` or `{{c1::text::hint}}`, holding no other.
 *
 * No brace inside, so a lone `{` or `}` makes it no mark, which keeps MathJax's
 * `{{c1::\(x^{2}\)}}` text. A nested mark is read by `parse`, innermost first,
 * each one swapped for a `HOLE` this admits as text. Lazy, so the second `::`
 * is the hint's and a mark ends at the first `}}`. The hint may be empty, so
 * `{{c1::A::}}` hides `A` rather than `A::`, and asks it as `[...]`. It holds
 * no hole, so `{{c1::a::{{c2::b}}}}` keeps `b` in the text where c2 can ask it.
 */
const MARK = /\{\{c(\d+)::([^{}]+?)(?:::([^{}]*?))?\}\}/g;

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
 * The line as text and marks, a mark holding any marks nested in it.
 *
 * Innermost first: each pass reads the marks holding no unread one, as Anki
 * 2.1.56 does, and an outer mark becomes one only once all inside it are. A
 * line is then a cloze exactly when it was before nesting was read. Each pass
 * shortens the line, so a deep line takes many passes and never hangs.
 */
function parse(line: string): Piece[] {
  const marks: Mark[] = [];
  let text = line;
  for (;;) {
    const read = text.replace(MARK, (_, number: string, body: string, hint?: string) => {
      marks.push({ cloze: Number(number), body: pieces(body, marks), hint });
      return `${marks.length - 1}`;
    });
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
 * The numbers the line's marks carry, ascending and each once.
 *
 * Ascending because the session addresses a card by its ordinal among its
 * note's cards, and a line's cards sort by the line alone: the order they are
 * pushed in is the order they keep, so it has to be the same on every read.
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
 * `text` with `&#58;` read as the colon markdown shows for it.
 *
 * The import writes a cloze answer's colons as `&#58;` where a typed `::`
 * would split the answer at a hint (#335). The preview draws no entity, so a
 * card decodes it before the preview sees it, a hand-written one too.
 */
export function colons(text: string): string {
  return text.replaceAll("&#58;", ":");
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
 * A card written on one line, split at its divider.
 *
 * The first `::` divides it, so an answer holding one of its own keeps it. The
 * schedule, the token and the Anki id come off the back, all being the format
 * around the card rather than part of the answer.
 *
 * An empty back comes back empty rather than as null. A question with no answer
 * under it is a card somebody wrote to answer later, which is a state and not a
 * non-card, and telling the two apart is the whole reason both readers call
 * this instead of each deciding for themselves.
 */
export function divide(line: string): Divided | null {
  const at = line.indexOf("::");
  if (at === -1) return null;
  return {
    front: withoutAnkiId(line.slice(0, at)).trim(),
    back: withoutToken(withoutAnkiId(line.slice(at + 2).replace(SR, ""))).trim(),
  };
}
