import { gradeExam, parseExam, resultNote, resultPath } from "@/lib/exam";

/** The shape the vault's four practice exams are written in, cut down to two questions. */
const NOTE = `---
id: 019fd770-e40a-72e7-9abc-2cc62eeaeb19
---
# Claude Certified Associate – Foundations (CCAO-F)

*Full Practice Question Set*

## Domain 1: Prompting and Task Execution (14%)

### Question 1.1 · Multiple choice · select ONE

A marketing associate types "write something" and is disappointed.
Which revision best reflects effective prompting?

- **A.** "Write something better."
- **B.** "Write a 150-word LinkedIn post."
- **C.** "Write about our product" three times.
- **D.** "You are the world's greatest copywriter."

## Domain 2: Output Evaluation (21%)

### Question 2.1 · Multiple response · select TWO

Which TWO practices make the improvement process reliable? (Select TWO.)

- **A.** Rewrite the entire prompt from scratch every time.
- **B.** Change one element at a time.
- **C.** Switch to a different product at the first sign of trouble.
- **D.** Test each revision against the same example input.

## Answer Key & Rationales

### Domain 1: Prompting and Task Execution

**1.1 — Correct: B**

Effective prompts supply the ingredients the model cannot guess.

Why not the others: A adds pressure without information.

### Domain 2: Output Evaluation

**2.1 — Correct: B, D**

One change at a time against a fixed input is what makes a result attributable.
`;

describe("parseExam", () => {
  it("reads the title off the first heading", () => {
    expect(parseExam(NOTE)?.title).toBe("Claude Certified Associate – Foundations (CCAO-F)");
  });

  it("finds every question, in the order the note writes them", () => {
    expect(parseExam(NOTE)?.questions.map((q) => q.id)).toEqual(["1.1", "2.1"]);
  });

  it("puts a question in the section whose heading is above it", () => {
    expect(parseExam(NOTE)?.questions.map((q) => q.section)).toEqual([
      "Prompting and Task Execution",
      "Output Evaluation",
    ]);
  });

  it("takes the prose between the heading and the first option as the stem", () => {
    expect(parseExam(NOTE)?.questions[0]?.stem).toBe(
      'A marketing associate types "write something" and is disappointed.\nWhich revision best reflects effective prompting?',
    );
  });

  it("reads the options as a letter and its text", () => {
    expect(parseExam(NOTE)?.questions[0]?.options).toEqual([
      { letter: "A", text: '"Write something better."' },
      { letter: "B", text: '"Write a 150-word LinkedIn post."' },
      { letter: "C", text: '"Write about our product" three times.' },
      { letter: "D", text: '"You are the world\'s greatest copywriter."' },
    ]);
  });

  it("pairs a question with its answer from the key at the back", () => {
    expect(parseExam(NOTE)?.questions[0]?.correct).toEqual(["B"]);
  });

  it("reads a multiple response answer as every letter it names", () => {
    expect(parseExam(NOTE)?.questions[1]?.correct).toEqual(["B", "D"]);
  });

  it("takes how many to pick off the question heading", () => {
    expect(parseExam(NOTE)?.questions.map((q) => q.pick)).toEqual([1, 2]);
  });

  it("keeps the rationale under the answer, up to the next one", () => {
    expect(parseExam(NOTE)?.questions[0]?.rationale).toBe(
      "Effective prompts supply the ingredients the model cannot guess.\n\nWhy not the others: A adds pressure without information.",
    );
  });

  it("does not take the answer key's own headings for questions", () => {
    expect(parseExam(NOTE)?.questions).toHaveLength(2);
  });

  it("answers with nothing for a note holding no question", () => {
    expect(parseExam("# Just a note\n\nSome prose.\n")).toBeNull();
  });

  it("reads a question the key never answers, and marks it unscored", () => {
    const note = `# T

## Domain 1: Patterns

### Question 1.1 · Scenario matching

Match each scenario to a pattern.

- **A.** one
- **B.** two

## Answer Key

1.1 — 1 → single call; 2 → fixed workflow
`;
    expect(parseExam(note)?.questions[0]?.correct).toEqual([]);
  });

  it("takes an answer key line that is not bold", () => {
    const note = NOTE.replace("**1.1 — Correct: B**", "1.1 — Correct: B");
    expect(parseExam(note)?.questions[0]?.correct).toEqual(["B"]);
  });

  it("takes a plain hyphen where the key writes an em-dash", () => {
    const note = NOTE.replace("**1.1 — Correct: B**", "**1.1 - Correct: B**");
    expect(parseExam(note)?.questions[0]?.correct).toEqual(["B"]);
  });

  it("takes an option written without the bold", () => {
    const note = NOTE.replace(
      '- **A.** "Write something better."',
      '- A. "Write something better."',
    );
    expect(parseExam(note)?.questions[0]?.options[0]).toEqual({
      letter: "A",
      text: '"Write something better."',
    });
  });

  it("strips a fractional weight off a section heading", () => {
    const note = NOTE.replace(
      "Domain 1: Prompting and Task Execution (14%)",
      "Domain 1: Prompting and Task Execution (14.7%)",
    );
    expect(parseExam(note)?.questions[0]?.section).toBe("Prompting and Task Execution");
  });

  it("counts a question it could not ask rather than dropping it in silence", () => {
    const note = NOTE.replace(
      "## Answer Key & Rationales",
      "### Question 1.2 · Scenario matching\n\nMatch each to a pattern.\n\n- A support email → ______\n\n## Answer Key & Rationales",
    );
    const exam = parseExam(note);
    expect(exam?.questions).toHaveLength(2);
    expect(exam?.skipped).toBe(1);
  });

  it("counts nothing skipped where every question has options", () => {
    expect(parseExam(NOTE)?.skipped).toBe(0);
  });

  // The format is not the Claude certification format. These pin the shapes a
  // hand-written quiz about anything else would reach for, so the parser cannot
  // quietly narrow back to the four notes it was read off.
  describe("a quiz that is not a Claude cert", () => {
    const QUIZ = `# Terraform drills

## Type conversion

### Q1

Which cast does Terraform refuse?

- A. string to number
- B. list to set
- C. bool to string

Correct: B

A set drops duplicates, so the conversion is not reversible.

### Q2 · choose 2

Which TWO are valid for_each collections?

- A. a list
- B. a set
- C. a map

Answer: B, C
`;

    it("takes an answer written under the question instead of in a key", () => {
      expect(parseExam(QUIZ)?.questions[0]?.correct).toEqual(["B"]);
    });

    it("keeps the prose under an inline answer as the rationale", () => {
      expect(parseExam(QUIZ)?.questions[0]?.rationale).toBe(
        "A set drops duplicates, so the conversion is not reversible.",
      );
    });

    it("reads `Answer:` as well as `Correct:`", () => {
      expect(parseExam(QUIZ)?.questions[1]?.correct).toEqual(["B", "C"]);
    });

    it("opens a question on `Q1` as well as on `Question 1.1`", () => {
      expect(parseExam(QUIZ)?.questions.map((q) => q.id)).toEqual(["1", "2"]);
    });

    it("takes a heading that never says the word domain as the section", () => {
      expect(parseExam(QUIZ)?.questions[0]?.section).toBe("Type conversion");
    });

    it("reads `choose 2` as two picks", () => {
      expect(parseExam(QUIZ)?.questions[1]?.pick).toBe(2);
    });

    it("numbers unnumbered questions by their order, so answers key apart", () => {
      const note = `# Drills

### Question

First?

- A. yes
- B. no

Correct: A

### Question

Second?

- A. yes
- B. no

Correct: B
`;
      const exam = parseExam(note);
      expect(exam?.questions.map((q) => q.id)).toEqual(["1", "2"]);
      expect(
        gradeExam(exam ?? { title: "", questions: [], skipped: 0 }, { "1": ["A"], "2": ["B"] })
          .right,
      ).toBe(2);
    });

    it("lets an inline answer win over a stale key at the back", () => {
      const note = `# Drills

### Question 1

Which?

- A. one
- B. two

Correct: A

## Answer Key

1 — Correct: B
`;
      expect(parseExam(note)?.questions[0]?.correct).toEqual(["A"]);
    });

    it("does not read the word answer in a stem as the answer", () => {
      const note = `# Drills

### Question 1

Correct: which of these is the best answer?

- A. one
- B. two

Correct: B
`;
      const question = parseExam(note)?.questions[0];
      expect(question?.correct).toEqual(["B"]);
      expect(question?.stem).toBe("Correct: which of these is the best answer?");
    });
  });

  it("leaves a question with no options out, so a prose heading is not one", () => {
    const note = `# T

## Domain 1: Patterns

### Question 1.1 · Multiple choice · select ONE

No options follow this one at all.
`;
    expect(parseExam(note)).toBeNull();
  });
});

describe("gradeExam", () => {
  const exam = parseExam(NOTE);
  if (exam === null) throw new Error("the fixture must parse");

  it("counts a single answer right when it matches", () => {
    expect(gradeExam(exam, { "1.1": ["B"] }).right).toBe(1);
  });

  it("counts a single answer wrong when it does not", () => {
    expect(gradeExam(exam, { "1.1": ["C"] }).right).toBe(0);
  });

  it("wants every letter of a multiple response, and no more", () => {
    expect(gradeExam(exam, { "2.1": ["B", "D"] }).right).toBe(1);
    expect(gradeExam(exam, { "2.1": ["B"] }).right).toBe(0);
    expect(gradeExam(exam, { "2.1": ["B", "C", "D"] }).right).toBe(0);
  });

  it("reads the letters in any order", () => {
    expect(gradeExam(exam, { "2.1": ["D", "B"] }).right).toBe(1);
  });

  it("counts an unanswered question as wrong rather than skipping it", () => {
    expect(gradeExam(exam, { "1.1": ["B"] }).asked).toBe(2);
  });

  it("leaves a question the key never answered out of the count", () => {
    const note = `# T

## Domain 1: Patterns

### Question 1.1 · Scenario matching

Match them.

- **A.** one
- **B.** two

## Answer Key

1.1 — 1 → A
`;
    const unscored = parseExam(note);
    if (unscored === null) throw new Error("the fixture must parse");
    expect(gradeExam(unscored, {}).asked).toBe(0);
  });

  it("scores each section on its own questions", () => {
    expect(gradeExam(exam, { "1.1": ["B"], "2.1": ["A"] }).sections).toEqual([
      { section: "Prompting and Task Execution", right: 1, asked: 1 },
      { section: "Output Evaluation", right: 0, asked: 1 },
    ]);
  });

  it("names every question that was missed, with what was answered", () => {
    const missed = gradeExam(exam, { "1.1": ["C"], "2.1": ["B", "D"] }).missed;
    expect(missed.map((m) => [m.question.id, m.gave])).toEqual([["1.1", ["C"]]]);
  });
});

describe("resultPath", () => {
  it("puts a sitting in a folder beside the exam it was taken from", () => {
    expect(resultPath("02 Projects/Certs/ccao-f-practice-exam.md", "2026-08-11", "14:32")).toBe(
      "02 Projects/Certs/ccao-f-practice-exam results/2026-08-11 1432.md",
    );
  });

  it("keeps an exam at the vault root out of a leading slash", () => {
    expect(resultPath("exam.md", "2026-08-11", "09:05")).toBe("exam results/2026-08-11 0905.md");
  });
});

describe("resultNote", () => {
  const exam = parseExam(NOTE);
  if (exam === null) throw new Error("the fixture must parse");
  const text = resultNote(
    exam,
    "02 Projects/Certs/ccao-f-practice-exam.md",
    gradeExam(exam, { "1.1": ["C"], "2.1": ["B", "D"] }),
    "2026-08-11 14:32",
  );

  it("links back to the exam it was taken from", () => {
    expect(text).toContain("[[02 Projects/Certs/ccao-f-practice-exam]]");
  });

  it("states the score and the percentage", () => {
    expect(text).toContain("1/2 (50%)");
  });

  it("breaks the score down by section", () => {
    expect(text).toContain("Prompting and Task Execution: 0/1");
    expect(text).toContain("Output Evaluation: 1/1");
  });

  it("writes out what was missed, with the right answer and the rationale", () => {
    expect(text).toContain("### 1.1");
    expect(text).toContain("You answered C, correct is B");
    expect(text).toContain("Effective prompts supply the ingredients");
  });

  it("leaves out what was answered right", () => {
    expect(text).not.toContain("### 2.1");
  });

  it("writes no frontmatter, which the backend stamps", () => {
    expect(text.startsWith("---")).toBe(false);
  });
});
