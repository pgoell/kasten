import { drinkTotals } from "@/lib/log-lines";
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

it("puts the line under a ## Log in a fence nobody closed rather than a new one", () => {
  const note = "# d\n\n```\n## Log\n- a\n";

  expect(appendUnder(note, "## Log", LINE)).toBe("# d\n\n```\n## Log\n- a\n- new line\n");
});

it("skips a ## Log in the frontmatter", () => {
  const note = "---\n## Log\n---\n# d\n\n## Log\n- a\n";

  expect(appendUnder(note, "## Log", LINE)).toBe(
    "---\n## Log\n---\n# d\n\n## Log\n- a\n- new line\n",
  );
});
