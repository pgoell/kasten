import { parseCallout } from "@/lib/callout";

describe("parseCallout", () => {
  const NAMES = [
    ["note", "note"],
    ["abstract", "abstract"],
    ["summary", "abstract"],
    ["tldr", "abstract"],
    ["info", "info"],
    ["todo", "todo"],
    ["tip", "tip"],
    ["hint", "tip"],
    ["important", "tip"],
    ["success", "success"],
    ["check", "success"],
    ["done", "success"],
    ["question", "question"],
    ["help", "question"],
    ["faq", "question"],
    ["warning", "warning"],
    ["caution", "warning"],
    ["attention", "warning"],
    ["failure", "failure"],
    ["fail", "failure"],
    ["missing", "failure"],
    ["danger", "danger"],
    ["error", "danger"],
    ["bug", "bug"],
    ["example", "example"],
    ["quote", "quote"],
    ["cite", "quote"],
  ].map(([type, kind]) => [type, kind] as const);

  it("reads every type and alias Obsidian ships as its kind", () => {
    for (const [type, kind] of NAMES) {
      expect(parseCallout(`[!${type}]`), type).toMatchObject({ type, kind });
    }
  });

  it("reads a type it does not know as a note", () => {
    expect(parseCallout("[!mytype]")).toMatchObject({ type: "mytype", kind: "note" });
  });

  it("reads the type without regard to case", () => {
    expect(parseCallout("[!TLDR]")).toMatchObject({
      type: "tldr",
      kind: "abstract",
      title: "Tldr",
    });
  });

  it("takes the text after the type as the title", () => {
    expect(parseCallout("[!warning] Mind the gap  ")).toEqual({
      type: "warning",
      kind: "warning",
      fold: "",
      title: "Mind the gap",
      titled: true,
      length: 11,
    });
  });

  it("titles one with none written by its type, fold sign or not", () => {
    for (const fold of ["", "-", "+"]) {
      expect(parseCallout(`[!faq]${fold}`), fold).toMatchObject({
        fold,
        title: "Faq",
        titled: false,
      });
    }
  });

  it("reads the fold sign before a title", () => {
    expect(parseCallout("[!faq]- Why")).toMatchObject({ fold: "-", title: "Why", length: 8 });
  });

  it("reads text that does not open with [!type] as no callout", () => {
    for (const text of ["note", "> [!note]", "[note]", "[! note]", "text [!note]"]) {
      expect(parseCallout(text), text).toBeNull();
    }
  });
});
