import { drinkTotals } from "@/lib/log/log-lines";
import { appendUnder } from "@/lib/note-section";

const HEADINGS = ["## Log", "## Done", "## Time", "## TODOs"];
const LINE = "- new line";

it.each(HEADINGS)("puts the line under %s with trailing spaces, not under a second one", (h) => {
  const note = `# d\n\n${h}  \n- old\n\n## Other\n`;

  expect(appendUnder(note, h, LINE)).toBe(`# d\n\n${h}  \n- old\n- new line\n\n## Other\n`);
});

it.each(HEADINGS)("skips a %s inside a fence and puts the line under the real one", (h) => {
  const note = `# d\n\n\`\`\`\n${h}\n\`\`\`\n\n${h}\n- old\n`;

  expect(appendUnder(note, h, LINE)).toBe(
    `# d\n\n\`\`\`\n${h}\n\`\`\`\n\n${h}\n- old\n- new line\n`,
  );
});

it.each(HEADINGS)("makes %s at the end when the only one is inside a fence", (h) => {
  const note = `# d\n\n\`\`\`\n${h}\n\`\`\`\n`;

  expect(appendUnder(note, h, LINE)).toBe(`# d\n\n\`\`\`\n${h}\n\`\`\`\n\n${h}\n- new line\n`);
});

it("does not end the section at a heading inside a fence in it", () => {
  const note = "## Log\n- a\n```\n## not a heading\n```\n- b\n\n## Next\n";

  expect(appendUnder(note, "## Log", LINE)).toBe(
    "## Log\n- a\n```\n## not a heading\n```\n- b\n- new line\n\n## Next\n",
  );
});

it("a line put under a fenced ## Log is counted by drinkTotals", () => {
  const note = "# d\n\n```\n## Log\n- ☕ 9\n```\n";

  expect(drinkTotals(appendUnder(note, "## Log", "- ☕ 1")).coffee.count).toBe(1);
});

it("puts the line under ## Log with a trailing tab", () => {
  const note = "## Log\t\n- a\n\n## Next\n";

  expect(appendUnder(note, "## Log", LINE)).toBe("## Log\t\n- a\n- new line\n\n## Next\n");
});

it("a line into a ## Log ending in an unclosed fence lands after a closer", () => {
  expect(appendUnder("## Log\n- 💧 250 ml\n```\ncode\n", "## Log", "- 💧 500 ml")).toBe(
    "## Log\n- 💧 250 ml\n```\ncode\n```\n- 💧 500 ml\n",
  );
});

it("a line into a ## Log ending in an unclosed fence is counted by drinkTotals", () => {
  expect(
    drinkTotals(appendUnder("## Log\n- 💧 250 ml\n```\ncode\n", "## Log", "- 💧 500 ml")).water.ml,
  ).toBe(750);
});

it("a note ending in an unclosed fence with no newline gets the closer on a line of its own", () => {
  expect(appendUnder("## Log\n- a\n```\ncode", "## Log", LINE)).toBe(
    "## Log\n- a\n```\ncode\n```\n- new line",
  );
});

it("a ## Log only in an unclosed fence gets the fence closed and one live ## Log", () => {
  const once = appendUnder("# d\n\n```\n## Log\n- a\n", "## Log", "- one");
  const twice = appendUnder(once, "## Log", "- two");

  expect([once, twice]).toEqual([
    "# d\n\n```\n## Log\n- a\n```\n\n## Log\n- one\n",
    "# d\n\n```\n## Log\n- a\n```\n\n## Log\n- one\n- two\n",
  ]);
});

it("the closer repeats a four-backtick opener", () => {
  expect(appendUnder("## Log\n- a\n````\nx\n", "## Log", LINE)).toBe(
    "## Log\n- a\n````\nx\n````\n- new line\n",
  );
});

it("a tilde fence is closed by tildes", () => {
  expect(appendUnder("## Log\n- a\n~~~\nx\n", "## Log", LINE)).toBe(
    "## Log\n- a\n~~~\nx\n~~~\n- new line\n",
  );
});

it("two lines into a ## Log ending in an unclosed fence leave one closer", () => {
  const once = appendUnder("## Log\n- a\n```\ncode\n", "## Log", "- one");

  expect(appendUnder(once, "## Log", "- two")).toBe("## Log\n- a\n```\ncode\n```\n- one\n- two\n");
});

it("an unclosed fence after the section is left alone", () => {
  expect(appendUnder("## Log\n- a\n\n## Notes\n```\ncode\n", "## Log", LINE)).toBe(
    "## Log\n- a\n- new line\n\n## Notes\n```\ncode\n",
  );
});

it("blank lines at the end of an unclosed fence stay inside it", () => {
  expect(appendUnder("## Log\n- a\n```\ncode\n\n\n", "## Log", LINE)).toBe(
    "## Log\n- a\n```\ncode\n\n\n```\n- new line\n",
  );
});

it("a line of inline triple-backtick code opens no fence", () => {
  expect(appendUnder("## Log\n- a\n```x```\n\n## Next\n", "## Log", LINE)).toBe(
    "## Log\n- a\n```x```\n- new line\n\n## Next\n",
  );
});

it("a note ending in inline triple-backtick code gets no closer", () => {
  expect(appendUnder("## Log\n- a\n```x```", "## Log", LINE)).toBe(
    "## Log\n- a\n```x```\n- new line",
  );
});

it("a backtick line that opens no fence gets the real fence closed", () => {
  expect(appendUnder("# d\n```x```\n```\n## Log\n- old\n", "## Log", LINE)).toBe(
    "# d\n```x```\n```\n## Log\n- old\n```\n\n## Log\n- new line\n",
  );
});

it("a fence in a list item gets no column-zero closer", () => {
  expect(appendUnder("## Log\n- item\n\n  ```\n  code\n", "## Log", LINE)).toBe(
    "## Log\n- item\n\n  ```\n  code\n- new line\n",
  );
});

it("an indented top-level fence still gets a closer", () => {
  expect(appendUnder("## Log\nsome text\n\n ```\ncode\n", "## Log", LINE)).toBe(
    "## Log\nsome text\n\n ```\ncode\n```\n- new line\n",
  );
});

it("a body below frontmatter ending in an unclosed fence gets a closer", () => {
  expect(appendUnder("---\nid: x\n---\n## Log\n- a\n```\ncode\n", "## Log", LINE)).toBe(
    "---\nid: x\n---\n## Log\n- a\n```\ncode\n```\n- new line\n",
  );
});

it("a fence-shaped line in the frontmatter gets no closer", () => {
  expect(appendUnder("---\nnote: x\n```\n---\n## Log\n- a\n", "## Log", LINE)).toBe(
    "---\nnote: x\n```\n---\n## Log\n- a\n- new line\n",
  );
});

it("a fence under a lazy list line gets no column-zero closer", () => {
  expect(appendUnder("## Log\n- a\nb\n\n  ```\n  code\n", "## Log", LINE)).toBe(
    "## Log\n- a\nb\n\n  ```\n  code\n- new line\n",
  );
});

it("a fence under a wide list marker gets no column-zero closer", () => {
  expect(appendUnder("## Log\n-     item\n\n  ```\n  code\n", "## Log", LINE)).toBe(
    "## Log\n-     item\n\n  ```\n  code\n- new line\n",
  );
});

it("drinkTotals counts a line written after a backtick line that opens no fence", () => {
  expect(
    drinkTotals(appendUnder("## Log\n- 💧 250 ml\n```x```\nfoo\n", "## Log", "- 💧 500 ml")).water
      .ml,
  ).toBe(750);
});

it("skips a ## Log in the frontmatter", () => {
  const note = "---\n## Log\n---\n# d\n\n## Log\n- a\n";

  expect(appendUnder(note, "## Log", LINE)).toBe(
    "---\n## Log\n---\n# d\n\n## Log\n- a\n- new line\n",
  );
});
