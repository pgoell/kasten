import { bodyOf, caretLine, noteText, phone, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { beside, layout, load, seed } from "../../panes/workspace/stored.ts";
import { LINED, onDisk, RAGGED, rowEnd, SAVE, stamped, TYPED_C, typeInLast } from "./table.ts";

/** The trimmed cells of one row, split on the walls a backslash does not escape. */
const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());

test.describe("the table line-up on save (#792 A9)", () => {
  for (const vim of ["off", "on"] as const) {
    test(`saving with vim ${vim} lines up the edited table under the cursor`, async ({
      page,
      stack,
    }) => {
      await rowEnd(page, stack.vault, RAGGED, 2, vim);
      await typeInLast(page, "c", vim);
      await SAVE[vim](page);
      await onDisk(stack.vault, LINED);
    });
  }

  test("cells, escapes, dash colons, CJK and emoji survive apart from padding", async ({
    page,
    stack,
  }) => {
    const rows = ["| name | note | code | mark |", "| :-- | :-: | --: | --- |"];
    rows.push("| 中文 | a \\| b | `x \\| y` | 🎉 |", "| k | v | w | |");
    await rowEnd(page, stack.vault, `${rows.join("\n")}\n\nafter`, 3, "off");
    await page.keyboard.press("Home");
    for (let step = 0; step < 3; step++) await page.keyboard.press("ArrowRight");
    await page.keyboard.type("z");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Control+s");
    await expect.poll(async () => bodyOf(await noteText(stack.vault, "Table.md"))).toMatch(/kz/);
    const lines = bodyOf(await noteText(stack.vault, "Table.md"))
      .split("\n")
      .slice(0, 4);
    // Every line the same width, counted in code points as the line-up counts.
    expect(new Set(lines.map((line) => [...line].length)).size).toBe(1);
    const dashes = (line: string) => cellsOf(line).map((cell) => cell.replace(/-+/g, "-"));
    expect(lines.map(dashes)).toEqual([
      ["name", "note", "code", "mark"],
      [":-", ":-:", "-:", "-"],
      ["中文", "a \\| b", "`x \\| y`", "🎉"],
      ["kz", "v", "w", ""],
    ]);
    const bare = (text: string) => text.replace(/ /g, "").replace(/-+/g, "-");
    expect(bare(lines.join("\n"))).toBe(bare(rows.join("\n").replace("| k |", "| kz |")));
  });

  test("a ragged table not typed into stays byte for byte beside one that was", async ({
    page,
    stack,
  }) => {
    const second = "| p | q |\n| - | - |\n| r | longerone |";
    await rowEnd(page, stack.vault, `${RAGGED}\n\n${second}`, 2, "off");
    await typeInLast(page, "c", "off");
    // The end of the note is the second table's last row.
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Control+s");
    await onDisk(stack.vault, `${LINED}\n\n${second}`);
  });

  test("a ragged table the cursor only passes through is saved as it was", async ({
    page,
    stack,
  }) => {
    await rowEnd(page, stack.vault, RAGGED, 0, "off");
    await page.keyboard.press("Control+End");
    await page.keyboard.type("!");
    await page.keyboard.press("Control+s");
    await onDisk(stack.vault, `${RAGGED}!`);
  });
});

test("a pipe table in a fence, a quote or a list item, or with no dashes, is never lined up (#792 I1)", async ({
  page,
  stack,
}) => {
  const fm = "---\nid: t\n---\n";
  const table = "| a | longer |\n| - | - |\n| xx | b |";
  const quoted = table.replace(/^/gm, "> ");
  const listed = `- item\n\n${table.replace(/^/gm, "  ")}`;
  const text = `${fm}\`\`\`\n${table}\n\`\`\`\n\n${quoted}\n\n${listed}\n\na | longer\nxx | b\n\nafter`;
  const rows = text.split("\n").flatMap((line, n) => (/xx \| b/.test(line) ? [n + 1] : []));
  expect(rows).toHaveLength(4);
  await rowEnd(page, stack.vault, text, 0, "on");
  for (const row of rows) {
    await page.keyboard.type(`${row}G0fbac`);
    await page.keyboard.press("Escape");
  }
  await page.keyboard.type("G");
  await SAVE.on(page);
  await onDisk(stack.vault, bodyOf(text).replaceAll("xx | b", "xx | bc"));
});

test.describe("the table line-up's undo (#792 I2)", () => {
  const KEYS = { on: ["G", "u", "Control+r"], off: ["Control+End", "Control+z", "Control+y"] };
  for (const vim of ["on", "off"] as const) {
    test(`the line-up is its own undo step, with vim ${vim}`, async ({ page, stack }) => {
      const [leave, undo, redo] = KEYS[vim];
      await rowEnd(page, stack.vault, RAGGED, 2, vim);
      await typeInLast(page, "c", vim);
      await page.keyboard.press(leave);
      await onDisk(stack.vault, LINED);
      for (const [key, text] of [
        [undo, TYPED_C],
        [undo, RAGGED],
        [redo, TYPED_C],
        [redo, LINED],
      ]) {
        await page.keyboard.press(key);
        await onDisk(stack.vault, text);
      }
    });
  }

  test("after u puts the ragged table back, leaving it again keeps it ragged, vim on", async ({
    page,
    stack,
  }) => {
    await rowEnd(page, stack.vault, RAGGED, 2, "on");
    await typeInLast(page, "c", "on");
    await page.keyboard.type("G");
    await onDisk(stack.vault, LINED);
    await page.keyboard.type("u");
    await onDisk(stack.vault, TYPED_C);
    await page.keyboard.type("3GGA!");
    await page.keyboard.press("Escape");
    await onDisk(stack.vault, `${TYPED_C}!`);
  });
});

test.describe("the table line-up keeps the cursor and skips what is square (#792 I3)", () => {
  test("a line-up on save keeps the cursor after the character it was after", async ({
    page,
    stack,
  }) => {
    await rowEnd(page, stack.vault, "| name | x |\n| - | - |\n| a | longer |\n\nafter", 2, "off");
    await page.keyboard.press("Home");
    for (let step = 0; step < 3; step++) await page.keyboard.press("ArrowRight");
    await page.keyboard.type("q");
    await page.keyboard.press("Control+s");
    const lined = "| name | x      |\n| ---- | ------ |\n| aq   | longer |\n\nafter";
    await onDisk(stack.vault, lined);
    await page.keyboard.type("Z");
    await onDisk(stack.vault, lined.replace("aq ", "aqZ "));
  });

  test("a table still square after an edit is not rewritten, so one undo takes the edit out", async ({
    page,
    stack,
  }) => {
    const square = "| a   | longer |\n| --- | ------ |\n| c   | d      |\n\nafter";
    await rowEnd(page, stack.vault, square, 2, "off");
    await page.keyboard.press("Home");
    for (let step = 0; step < 3; step++) await page.keyboard.press("ArrowRight");
    // The space after the `c` is typed over, so the cell is still as wide as its column.
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.type("x");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Control+s");
    await onDisk(stack.vault, square.replace("| c   |", "| cx  |"));
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+s");
    await onDisk(stack.vault, square);
  });
});

test.describe("what is not the reader's typing is never lined up (#792 I4)", () => {
  test("a write from outside taken into the open note leaves its table ragged", async ({
    page,
    stack,
  }) => {
    await rowEnd(page, stack.vault, RAGGED, 4, "off");
    const outside = RAGGED.replace("| xx | b |", "| xx | bq |");
    await vaultWith(stack.vault, { "Table.md": outside });
    await expect(page.locator(".cm-content")).toContainText("bq");
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+End");
    await page.keyboard.type("!");
    await page.keyboard.press("Control+s");
    await onDisk(stack.vault, `${outside}!`);
  });

  test("typing that reaches a second pane on the same note leaves its table ragged there", async ({
    page,
    stack,
  }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await vaultWith(stack.vault, { "Table.md": RAGGED });
    await seed(page, layout([beside({ path: "Table.md" }, { path: "Table.md" })]));
    await load(page);
    const [left, right] = [0, 1].map((n) => page.locator(".cm-content:visible").nth(n));
    await left.getByText("after", { exact: true }).click();
    // Arrows from below a drawn table enter it at its head, so go round by the top.
    await page.keyboard.press("Control+Home");
    for (let step = 0; step < 2; step++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await typeInLast(page, "c", "off");
    await expect(right).toContainText("bc");
    await right.getByText("after", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.keyboard.press("Control+s");
    await onDisk(stack.vault, `${TYPED_C}!`);
  });
});

test("in Read, the cursor's row wears the wash and the line-up on leaving still runs (#792 I6)", async ({
  page,
  stack,
}) => {
  await rowEnd(page, stack.vault, RAGGED, 2, "off");
  // The rows whose background is not the plain line's below the table.
  const washed = () =>
    page.locator(".cm-content:visible .cm-line").evaluateAll((lines) => {
      const plain = getComputedStyle(lines[lines.length - 1] as Element).backgroundColor;
      return lines
        .filter((line) => getComputedStyle(line).backgroundColor !== plain)
        .map((line) => line.textContent);
    });
  await expect.poll(washed).toEqual(["| xx | b |"]);
  await typeInLast(page, "c", "off");
  await expect.poll(washed).toEqual(["| xx | bc |"]);
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+s");
  await onDisk(stack.vault, LINED);
});

test("a row with fewer or more cells than the head keeps every cell through the line-up (#792 I8)", async ({
  page,
  stack,
}) => {
  const source = "| a | b | c |\n| - | - | - |\n| 1 |\n| x | y | z | w |\n\nafter";
  await rowEnd(page, stack.vault, source, 2, "off");
  await typeInLast(page, "q", "off");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+s");
  const rows = ["| a   | b   | c   |     |", "| --- | --- | --- | --- |"];
  rows.push("| 1q  |     |     |     |", "| x   | y   | z   | w   |", "", "after");
  await onDisk(stack.vault, rows.join("\n"));
});

test.describe("on a phone", () => {
  test.use(phone);

  for (const vim of ["off", "on"] as const) {
    test(`a table typed into with vim ${vim} is lined up when a tap leaves it (#2288)`, async ({
      page,
      stack,
    }) => {
      await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
      await vaultWith(stack.vault, { "Table.md": RAGGED });
      await page.goto("/?note=Table.md");
      const after = page.locator(".cm-content:visible").getByText("after", { exact: true });
      await after.tap();
      await expect(caretLine(page)).toHaveText("after");
      if (vim === "on") {
        await page.keyboard.type("3G$");
      } else {
        // Arrows from below a drawn table enter it at its head, so go round by the top.
        await page.keyboard.press("Control+Home");
        for (let step = 0; step < 2; step++) await page.keyboard.press("ArrowDown");
        await page.keyboard.press("End");
      }
      await typeInLast(page, "c", vim);
      // A finger is slower than the first save, whose frontmatter lands on top of the table.
      await stamped(page);
      await after.tap();
      await expect(caretLine(page)).toHaveText("after");
      await onDisk(stack.vault, LINED);
    });
  }
});
