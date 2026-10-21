import { expect, it } from "vitest";
import { editedLine, removeLine, replaceLine } from "@/lib/log-edit";
import type { LogKind } from "@/lib/log-kinds";

const tea: LogKind = { mark: "🍵", name: "tea", tap: 1, unit: "cup" };

it("#624 replaceLine patches the one line and keeps the rest byte for byte", () => {
  const note = "# 2026-10-20\n\n## Log\n- ☕ 1\n- 🍺 1\n\n## Done\n- [ ] write\r\n";

  expect(replaceLine(note, { line: 5, text: "- 🍺 1" }, "- 🍺 2")).toBe(
    "# 2026-10-20\n\n## Log\n- ☕ 1\n- 🍺 2\n\n## Done\n- [ ] write\r\n",
  );
});

it("#624 an edit or delete of a line that changed since the read writes nothing and says why", () => {
  const note = "## Log\n- ☕ 1\n- 🍺 1\n";
  const changed = { why: "that line has changed since the pane read it" };

  // Line 3 reads other text, and line 9 is not there: both refuse, since the text is what is checked.
  expect(replaceLine(note, { line: 3, text: "- 🍺 2" }, "- 🍺 3")).toEqual(changed);
  expect(removeLine(note, { line: 9, text: "- 🍺 1" })).toEqual(changed);
});

it("#624 editedLine rewrites water, alcohol, tea and a food's meal and servings", () => {
  expect(editedLine({ text: "- 💧 250 ml", kind: "water" }, { amount: "500" })).toBe("- 💧 500 ml");
  expect(editedLine({ text: "- ☕ 1", kind: "coffee" }, { amount: "2" })).toBe("- ☕ 2");
  expect(editedLine({ text: "- 🍺 2 330 ml 5%", kind: "alcohol" }, { amount: "1" })).toBe(
    "- 🍺 1 330 ml 5%",
  );
  expect(editedLine({ text: "- 🍵 1 cup", kind: "mine" }, { amount: "2" }, tea)).toBe("- 🍵 2 cup");
  expect(
    editedLine(
      { text: "- 🍽 lunch: Oats 40 g 🔥 150 kcal 🥩 5 g", kind: "food" },
      { meal: "dinner", servings: "2" },
    ),
  ).toBe("- 🍽 dinner: Oats 80 g 🔥 300 kcal 🥩 10 g");
});

it("#624 an edit typed as no amount writes nothing and says why", () => {
  expect(editedLine({ text: "- 💧 250 ml", kind: "water" }, { amount: "two cups" })).toEqual({
    why: expect.any(String),
  });
  expect(editedLine({ text: "- 💧 250 ml", kind: "water" }, { amount: "250 cups" })).toEqual({
    why: expect.any(String),
  });
  expect(editedLine({ text: "- ☕ 1", kind: "coffee" }, { amount: "0" })).toEqual({
    why: expect.any(String),
  });
  expect(editedLine({ text: "- 🍺 2", kind: "alcohol" }, { amount: "1.5" })).toEqual({
    why: expect.any(String),
  });
  expect(editedLine({ text: "- 🍺 2", kind: "alcohol" }, { amount: "0" })).toEqual({
    why: expect.any(String),
  });
  expect(editedLine({ text: "- 🍺 2", kind: "alcohol" }, { amount: "2 ml" })).toEqual({
    why: expect.any(String),
  });
  expect(editedLine({ text: "- 🍵 1 cup", kind: "mine" }, { amount: "" }, tea)).toEqual({
    why: "type an amount",
  });
  expect(editedLine({ text: "- 🍽 Oats 🔥 150 kcal", kind: "food" }, { servings: "0" })).toEqual({
    why: "servings must be a number above zero",
  });
});
