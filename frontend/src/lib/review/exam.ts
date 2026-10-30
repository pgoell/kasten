/**
 * Reads a practice exam out of a note, and writes down how a sitting went.
 * Nothing marks a note as an exam: one with no question headings reads as no exam at all.
 */

/** One option of one question: the letter you press, and what it says. */
export interface Option {
  letter: string;
  text: string;
}

/** One question, everything about it the note holds. */
export interface Question {
  /**
   * What the note numbers it, `1.1` or `7`, which a key at the back names it by.
   * Unnumbered, the heading's own text, so two questions are never the same question.
   */
  id: string;
  /** The heading above it, without its number or its weight. Empty where there is none. */
  section: string;
  /** The prose between the heading and the first option. */
  stem: string;
  options: Option[];
  /**
   * How many letters to pick, from `select TWO` or `choose 3` in the heading. Where the
   * heading says nothing it is one, the harmless guess. A count, not a flag, since the pane shows it.
   */
  pick: number;
  /**
   * The letters the answer names, empty where the note never answers it.
   * Empty means not scorable, not wrong: grading leaves such a question out.
   */
  correct: string[];
  /** What the note says under the answer, up to the next question or heading. */
  rationale: string;
}

/** One exam as the note holds it. */
export interface Exam {
  /** The note's first heading, which is what the exam is called. */
  title: string;
  questions: Question[];
  /**
   * How many question headings held nothing this could ask.
   * Shown in the pane, not hidden, so a short sitting never passes for the whole note.
   */
  skipped: number;
}

/** How one section went. */
export interface SectionScore {
  section: string;
  right: number;
  asked: number;
}

/** One question that was missed, and what was given for it. */
export interface Missed {
  question: Question;
  gave: string[];
}

/** How a sitting went. */
export interface Grade {
  right: number;
  /** How many questions counted, which leaves out the ones the note never answered. */
  asked: number;
  sections: SectionScore[];
  missed: Missed[];
}

/** What was picked for each question, by the id the note numbers it. */
export type Answers = Record<string, string[]>;

// `Q` as well as `Question`, and the number optional: `### Question 1.1`,
// `### Q7` and a bare `### Question` all open one. `#{2,6}` rather than a fixed
// level, because nothing about an exam depends on how deep its headings sit.
const QUESTION = /^(#{2,6})\s+(?:Question|Q)\.?\s*([\d.]+)?\s*(?:[·|:-]\s*(.*))?$/i;

// Any other heading groups the questions under it. A leading `Domain 3:` or
// `Section 2.` is dropped along with a trailing weight, so `## Domain 1: Prompting
// (14%)` and `## Prompting` are the same section and a rationale keyed under
// either spelling still finds its question.
const SECTION =
  /^#{2,6}\s+(?:(?:domain|section|topic|part|chapter|module|area)\s+)?(?:[\dIVXivx]+[).:.]?\s+)?(.+?)\s*(?:\(\d+(?:\.\d+)?%\))?$/i;

// `**A.**`, `A.` and `A)` all read as the letter A. The bold is what the vault's
// Claude exams write and the bare letter is what anybody writing one by hand
// reaches for. A single letter only, so an ordinary bulleted list inside a stem
// is not mistaken for the options.
const OPTION = /^\s*[-*]\s+(?:\*\*([A-Za-z])[.)]?\*\*|([A-Za-z])[.)])\s+(.*)$/;

// One row of a scenario matching question: the scenario, then an arrow at the
// blank it is classified into. `->` as well as `→`, because a keyboard writes
// the first and a note written in an editor arrives with it.
const ROW = /^\s*[-*]\s+(.*?)\s*(?:→|->)\s*_*\s*$/;

// The option set every row of a scenario matching question chooses from,
// written on one line under them: `Options: MCP server · direct API call`.
const CHOICES = /^\**\s*Options\s*[:=]\s*(.+?)\s*\**$/i;

// A matching answer, which names each row by its position rather than by a
// letter: `1 → MCP server; 2 → direct API call`.
const PAIRS = /(\d+)\s*(?:→|->)\s*([^;\n]+)/g;

// The same in a key at the back, where the question number opens the line. No
// `Correct:` in it, which is why `KEYED` does not see it.
const KEYED_MATCH = /^\**\s*([\d.]+)\s*[—–-]\s*(\d+\s*(?:→|->)\s*[^*\n]+?)\s*\**$/;

// An answer in a key at the back, which names the question it belongs to. The
// dash class is `—–-` because the vault writes an em-dash and a keyboard writes
// a hyphen; the bold is optional for the reason the option's is.
const KEYED = /^\**\s*([\d.]+)\s*[—–-]\s*(?:Correct|Answer)s?\s*[:=]\s*([^*\n]+?)\s*\**$/i;

// An answer written under the question itself, which needs no number: the
// question it belongs to is the one it sits in.
const INLINE = /^\**\s*(?:Correct|Answer)s?\s*[:=]\s*([^*\n]+?)\s*\**$/i;

// Everything after this heading is the key rather than the questions. Without
// it a key that restates its section headings would grow a second run of
// sections, and any exam whose key repeats a question would ask it twice.
const KEY_HEADING = /^#{1,6}\s+(?:Answer|Answers|Solutions?|Key|Rationales?)\b/i;

const TITLE = /^#\s+(.+)$/;

/** The letters a question's options are picked with, in order. */
export const LETTERS = "ABCDEFGHIJ";

const COUNTS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/** How many letters a question wants, off `select TWO` in its heading. */
function picksOf(suffix: string): number {
  const found = /(?:select|choose|pick)\s+(\w+)/i.exec(suffix);
  const word = found?.[1]?.toLowerCase() ?? "";
  return COUNTS[word] ?? (Number.parseInt(word, 10) || 1);
}

/** The letters an answer names, however it spelled the separator between them. */
function lettersOf(answer: string): string[] {
  return answer
    .split(/[^A-Za-z]+/)
    .filter((part) => part.length === 1)
    .map((part) => part.toUpperCase());
}

/** What a matching answer says, by the row number it says it of. */
function pairsOf(answer: string): Map<number, string> {
  const said = new Map<number, string>();
  for (const [, at, text] of answer.matchAll(PAIRS)) {
    said.set(Number.parseInt(at ?? "", 10), text ?? "");
  }
  return said;
}

/** An option's text as it compares: the spacing and the closing stop do not count. */
function norm(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
}

/** The letter of the option an answer names, or nothing where it names none. */
function letterOf(answer: string | undefined, options: Option[]): string[] {
  if (answer === undefined) return [];
  const found = options.find((option) => norm(option.text) === norm(answer));
  return found === undefined ? [] : [found.letter];
}

/** The lines of `text` with the leading `---` block taken off. */
function withoutFrontmatter(text: string): string[] {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return lines;

  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return close === -1 ? lines : lines.slice(close + 1);
}

/** Trim the blank lines off both ends of a block, leaving the ones inside it. */
function tidy(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/^\s*\n/, "")
    .replace(/\s+$/, "");
}

/** What a key at the back says about one question, in either spelling. */
interface Keyed {
  /** The letters an ordinary answer names. */
  correct: string[];
  /** A matching answer as written, `1 → MCP server; 2 → …`. Empty where it is not one. */
  match: string;
  rationale: string;
}

/**
 * Everything a key at the back says, by the question number it names.
 * One pass: an answer line opens a rationale, closed by the next answer line or heading.
 */
function readKey(lines: string[]): Map<string, Keyed> {
  const key = new Map<string, Keyed>();
  let open: (Keyed & { id: string; from: number }) | null = null;

  const close = (until: number) => {
    if (open === null) return;
    key.set(open.id, {
      correct: open.correct,
      match: open.match,
      rationale: tidy(lines.slice(open.from, until)),
    });
    open = null;
  };

  lines.forEach((line, index) => {
    const answer = KEYED.exec(line);
    if (answer !== null) {
      close(index);
      open = {
        id: answer[1] ?? "",
        correct: lettersOf(answer[2] ?? ""),
        match: "",
        rationale: "",
        from: index + 1,
      };
      return;
    }
    const matched = KEYED_MATCH.exec(line);
    if (matched !== null) {
      close(index);
      open = {
        id: matched[1] ?? "",
        correct: [],
        match: matched[2] ?? "",
        rationale: "",
        from: index + 1,
      };
      return;
    }
    if (/^#{1,6}\s/.test(line)) close(index);
  });
  close(lines.length);

  return key;
}

/**
 * The questions a scenario matching block holds, one for each row, over its shared option set.
 * Splitting here lets the pane, grading and result note handle one kind of question.
 */
function matching(block: string[], id: string, section: string, keyed?: Keyed): Question[] {
  const rows: string[] = [];
  let firstRow = block.length;
  let choices = "";
  let inlineAt = -1;

  block.forEach((line, index) => {
    const row = ROW.exec(line);
    if (row !== null) {
      if (rows.length === 0) firstRow = index;
      rows.push((row[1] ?? "").trim());
      return;
    }
    const found = CHOICES.exec(line);
    if (found !== null) choices = found[1] ?? "";
    // Only after the rows, for the reason the lettered path takes its answer
    // only after the options: a scenario is free to contain the word "answer".
    else if (inlineAt === -1 && rows.length > 0 && INLINE.test(line)) inlineAt = index;
  });

  if (rows.length === 0 || choices === "") return [];

  const options = choices
    .split(/\s*[·|;]\s*/)
    .filter((text) => text !== "")
    .slice(0, LETTERS.length)
    .map((text, index) => ({ letter: LETTERS[index] ?? "", text }));

  const inline = inlineAt === -1 ? null : INLINE.exec(block[inlineAt] ?? "");
  const said = pairsOf(inline !== null ? (inline[1] ?? "") : (keyed?.match ?? ""));
  const stem = tidy(block.slice(0, firstRow));

  return rows.map((row, index) => ({
    // Numbered under the question the note numbers, so a row keys apart from
    // its neighbours and still says where it came from.
    id: `${id}.${index + 1}`,
    section,
    stem: stem === "" ? row : `${stem}\n\n${row}`,
    options,
    pick: 1,
    correct: letterOf(said.get(index + 1), options),
    rationale: inline !== null ? tidy(block.slice(inlineAt + 1)) : (keyed?.rationale ?? ""),
  }));
}

/**
 * The exam a note holds, or nothing where it holds none.
 * A heading with no options under it is no question, which keeps `## Question Formats` out.
 */
export function parseExam(text: string): Exam | null {
  const lines = withoutFrontmatter(text);
  const keyAt = lines.findIndex((line) => KEY_HEADING.test(line));
  const body = keyAt === -1 ? lines : lines.slice(0, keyAt);
  const key = readKey(keyAt === -1 ? [] : lines.slice(keyAt + 1));

  const questions: Question[] = [];
  let skipped = 0;
  let section = "";
  let open: { id: string; pick: number; from: number } | null = null;

  const close = (until: number) => {
    if (open === null) return;

    const block = body.slice(open.from, until);
    const options: Option[] = [];
    let firstOption = block.length;
    let inlineAt = -1;

    block.forEach((line, index) => {
      const found = OPTION.exec(line);
      if (found !== null) {
        if (options.length === 0) firstOption = index;
        options.push({
          letter: (found[1] ?? found[2] ?? "").toUpperCase(),
          text: (found[3] ?? "").trim(),
        });
        return;
      }
      // Only after the options: a stem is free to contain the word "answer",
      // and taking the first match anywhere in the block would read a question
      // about answers as its own answer.
      if (inlineAt === -1 && options.length > 0 && INLINE.test(line)) inlineAt = index;
    });

    if (options.length === 0) {
      const rows = matching(block, open.id, section, key.get(open.id));
      if (rows.length === 0) skipped += 1;
      else questions.push(...rows);
    } else {
      const inline = inlineAt === -1 ? null : INLINE.exec(block[inlineAt] ?? "");
      const keyed = key.get(open.id);
      questions.push({
        id: open.id,
        section,
        stem: tidy(block.slice(0, firstOption)),
        options,
        pick: open.pick,
        // Inline wins. It sits with the question, so it is the one a reader
        // edits, and a key at the back that disagrees is the stale copy.
        correct: inline !== null ? lettersOf(inline[1] ?? "") : (keyed?.correct ?? []),
        rationale: inline !== null ? tidy(block.slice(inlineAt + 1)) : (keyed?.rationale ?? ""),
      });
    }
    open = null;
  };

  body.forEach((line, index) => {
    const question = QUESTION.exec(line);
    if (question !== null) {
      close(index);
      // Numbered by the note where it says a number, and by its own heading
      // where it does not, so an unnumbered exam still keys its answers apart.
      const id = question[2] ?? `${questions.length + skipped + 1}`;
      open = { id, pick: picksOf(question[3] ?? ""), from: index + 1 };
      return;
    }
    const found = SECTION.exec(line);
    if (found !== null) {
      close(index);
      section = found[1] ?? "";
    }
  });
  close(body.length);

  if (questions.length === 0) return null;

  const title = body.map((line) => TITLE.exec(line)?.[1]).find((found) => found !== undefined);
  return { title: title ?? "Practice exam", questions, skipped };
}

/** Whether two sets of letters name the same answer, in any order. */
function same(gave: string[], want: string[]): boolean {
  return gave.length === want.length && [...want].every((letter) => gave.includes(letter));
}

/**
 * How a sitting went, question by question and section by section.
 * A question never answered is left out of every count, not marked wrong: nothing can say it was right.
 */
export function gradeExam(exam: Exam, answers: Answers): Grade {
  const scorable = exam.questions.filter((question) => question.correct.length > 0);
  const missed: Missed[] = [];
  const sections: SectionScore[] = [];

  for (const question of scorable) {
    const gave = answers[question.id] ?? [];
    const right = same(gave, question.correct);
    if (!right) missed.push({ question, gave });

    const score = sections.find((entry) => entry.section === question.section);
    if (score === undefined) {
      sections.push({ section: question.section, right: right ? 1 : 0, asked: 1 });
    } else {
      score.asked += 1;
      score.right += right ? 1 : 0;
    }
  }

  return { right: scorable.length - missed.length, asked: scorable.length, sections, missed };
}

/**
 * Where a sitting's result note goes: a folder beside the exam, named for it.
 * One note per sitting, not appended, so a create needs no read and cannot lose a sitting to a racing write.
 */
export function resultPath(exam: string, date: string, time: string): string {
  const stem = exam.replace(/\.md$/, "");
  return `${stem} results/${date} ${time.replace(":", "")}.md`;
}

/** A percentage as a whole number, and zero where nothing was asked. */
function percent(right: number, asked: number): number {
  return asked === 0 ? 0 : Math.round((100 * right) / asked);
}

/**
 * The result note's text, without frontmatter, which the backend stamps.
 * Keeps the missed questions with stem, answer and rationale, so the note reads without the exam open.
 */
export function resultNote(exam: Exam, path: string, grade: Grade, when: string): string {
  const stem = path.replace(/\.md$/, "");
  const lines = [
    `# ${exam.title}, ${when}`,
    "",
    `[[${stem}]]`,
    "",
    `**${grade.right}/${grade.asked} (${percent(grade.right, grade.asked)}%)**`,
    "",
    "## By section",
    "",
    ...grade.sections.map(
      (score) =>
        `- ${score.section || "Unsorted"}: ${score.right}/${score.asked} (${percent(score.right, score.asked)}%)`,
    ),
  ];

  if (grade.missed.length > 0) {
    lines.push("", "## Missed", "");
    for (const { question, gave } of grade.missed) {
      const answered = gave.length === 0 ? "nothing" : gave.join(", ");
      lines.push(
        `### ${question.id}${question.section === "" ? "" : ` · ${question.section}`}`,
        "",
        question.stem,
        "",
        `You answered ${answered}, correct is ${question.correct.join(", ")}.`,
        "",
      );
      if (question.rationale !== "") lines.push(question.rationale, "");
    }
  }

  return `${tidy(lines)}\n`;
}
