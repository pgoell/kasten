import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import {
  bodyOf,
  builtCss,
  leader,
  listLines,
  noteText,
  openApp,
  openLists,
  openNote,
  phone,
  TODO_ROW,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const box = (at: Page | Locator, name: string) => at.getByRole("checkbox", { name, exact: true });
const group = (page: Page, name: string) => page.getByRole("region", { name });
const field = (page: Page) => page.getByRole("textbox", { name: "Eintrag" });
const read = (boxes: Locator, key: string) =>
  boxes.evaluateAll((all, k) => all.map((one) => one.getAttribute(k)), key);

/** The page's scheme and the colour the theme's CSS paints its background with. */
const painted = (page: Page) =>
  page.evaluate(() => [
    document.documentElement.dataset.theme,
    getComputedStyle(document.body).backgroundColor,
  ]);

test.describe("on a phone", () => {
  test.use(phone);
  test.use({ colorScheme: "dark" });

  test("the lists app is dark when the phone is dark and turns light when the phone does, while open", async ({
    page,
    stack,
  }) => {
    await openLists(page, stack.vault);
    await expect.poll(async () => (await painted(page))[0]).toBe("dark");
    const [, dark] = await painted(page);

    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(async () => (await painted(page))[0]).toBe("light");
    expect((await painted(page))[1]).not.toBe(dark);
  });

  test("open rows come first, Erledigt counts the done, a tap ticks and unticks, and Leeren empties the done", async ({
    page,
    stack,
  }) => {
    const list =
      "- [x] Eier ✅ 2026-11-01\n- [ ] Milch 🆔 abc123\n- [x] Zitronen ✅ 2026-11-02\n- [ ] Brot\n";
    await openLists(page, stack.vault, list);
    const boxes = page.getByRole("checkbox");
    expect(await read(boxes, "aria-label")).toEqual(["Milch", "Brot", "Eier", "Zitronen"]);
    expect(await read(boxes, "aria-checked")).toEqual(["false", "false", "true", "true"]);
    await expect(page.getByRole("heading", { name: "Erledigt 2" })).toBeVisible();
    for (const mark of ["- [", "✅", "🆔", "abc123", "2026"]) {
      await expect(page.locator("body")).not.toContainText(mark);
    }

    const done = group(page, "Erledigt");
    await box(page, "Brot").tap();
    await expect(box(done, "Brot")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("heading", { name: "Erledigt 3" })).toBeVisible();
    await box(done, "Eier").tap();
    await expect(box(group(page, "Offen"), "Eier")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("heading", { name: "Erledigt 2" })).toBeVisible();

    await page.getByRole("button", { name: "Leeren" }).tap();
    await expect(done).toHaveCount(0);
    await expect
      .poll(() => listLines(stack.vault))
      .toEqual(["- [ ] Eier", "- [ ] Milch 🆔 abc123"]);
  });

  test("first letters offer a done item and not an open one, a blank Enter writes nothing, and Enter adds and keeps the field", async ({
    page,
    stack,
  }) => {
    await openLists(page, stack.vault, "- [x] Milch ✅ 2026-11-01\n- [ ] Mineralwasser\n");
    await field(page).fill("Mi");
    await expect(page.getByRole("group", { name: "Vorschläge" }).getByRole("button")).toHaveText([
      "Milch",
    ]);

    await field(page).fill("   ");
    await field(page).press("Enter");
    await field(page).fill("Brot");
    await field(page).press("Enter");
    await expect(box(group(page, "Offen"), "Brot")).toBeVisible();
    await expect(field(page)).toHaveValue("");
    await expect(field(page)).toBeFocused();
    // One line more than the two written: the blank Enter, queued first, wrote none.
    await expect
      .poll(() => listLines(stack.vault))
      .toEqual([
        "- [x] Milch ✅ 2026-11-01",
        "- [ ] Mineralwasser",
        expect.stringMatching(/^- \[ \] Brot\b/),
      ]);
    await expect(page.getByRole("checkbox")).toHaveCount(3);
    // A blank add that reached the server comes back refused, as an error on screen.
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("an empty list says so, and the offline pill shows while the phone is offline", async ({
    page,
    context,
    stack,
  }) => {
    await openLists(page, stack.vault, "");
    await expect(page.getByText("Nichts auf der Liste")).toBeVisible();
    const pill = page.getByText("Offline, wird gesendet");
    await expect(pill).toHaveCount(0);
    // Set once the page is up: a load while offline fails before the app runs.
    await context.setOffline(true);
    await expect(pill).toBeVisible();
    await context.setOffline(false);
    await expect(pill).toHaveCount(0);
  });

  test("links kasten's owner back to kasten, and nobody else", async ({ page, stack }) => {
    // The e2e stack names no share people, so the owner's answer stands in for the proxy's.
    const me = { me: "Pascal", people: ["Pascal"], home: "https://kasten.example/" };
    await page.route("**/share/me", (route) => route.fulfill({ json: me }));
    await openLists(page, stack.vault);
    await expect(page.getByRole("link", { name: "kasten" })).toHaveAttribute("href", me.home);

    await page.unroute("**/share/me");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(box(page, "Milch")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "kasten" })).toHaveCount(0);
  });
});

test("the lists app's top bar blurs the list behind it, with Safari's prefix ahead in the css", async ({
  page,
  stack,
}) => {
  await openLists(page, stack.vault);
  // Vite's Lightning CSS minifier dropped this line when the source wrote the -webkit- twin after it (#1986).
  expect(
    await page.locator("header.top").evaluate((bar) => getComputedStyle(bar).backdropFilter),
  ).toBe("blur(18px) saturate(1.4)");
  expect(await builtCss(page)).toMatch(
    /\.top\{[^}]*-webkit-backdrop-filter:blur\(18px\) ?saturate\(1\.4\);backdrop-filter:blur\(18px\) ?saturate\(1\.4\)[;}]/,
  );
});

const SCOPE = {
  "02 Projects/Calls.md": "# Calls\n\n- [ ] call the client #client\n- [ ] fix the tap #internal\n",
  "05 Shared/Einkauf.md": "# Einkauf\n\n- [ ] send the offer #client\n",
};
const row = (page: Page, text: string) => page.locator(TODO_ROW, { hasText: text });
const toggle = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** The todo pane over SCOPE's two notes, once its rows are drawn. */
async function todoPane(page: Page, vault: string): Promise<void> {
  await vaultWith(vault, SCOPE);
  await openApp(page);
  await leader(page, "gt");
  await expect(row(page, "call the client")).toBeVisible();
}

test.describe("the todo pane's shared lists", () => {
  // The import leaves a shared list's lines in its note, so the store holds none of them.
  test("stay out of the pane, which then draws no shared lists toggle", async ({ page, stack }) => {
    await todoPane(page, stack.vault);
    await expect(row(page, "fix the tap")).toBeVisible();
    await expect(row(page, "send the offer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Shared lists/ })).toHaveCount(0);
  });

  test("a kind chip and the typed filter narrow the list together, and All widens it", async ({
    page,
    stack,
  }) => {
    await todoPane(page, stack.vault);
    await toggle(page, "#client").click();
    await expect(row(page, "call the client")).toBeVisible();
    await expect(row(page, "fix the tap")).toHaveCount(0);
    await expect(row(page, "fold the laundry")).toHaveCount(0);

    await page.getByLabel("filter todos").fill("call");
    await expect(row(page, "call the client")).toBeVisible();
    await page.getByLabel("filter todos").fill("tap");
    await expect(row(page, "call the client")).toHaveCount(0);
    await expect(row(page, "fix the tap")).toHaveCount(0);

    await page.getByLabel("filter todos").fill("");
    await toggle(page, "All").click();
    await expect(row(page, "fix the tap")).toBeVisible();
    await expect(row(page, "fold the laundry")).toBeVisible();
  });
});

test.describe("<leader>@, the agent key on a note's line (#523)", () => {
  /** Each step: the keys, then the line `Agent.md` saves, or the reason a refusal names. */
  type Step = [keys: string, saved: string | { refused: string }];
  const AGENT = "Space @";
  const TODAY = "2026-08-10";

  async function openAgent(page: Page, vault: string, body: string, vim: "on" | "off") {
    await page.addInitScript((v) => localStorage.setItem("kasten.vim", v), vim);
    // The key stamps the date it reads at the press.
    await page.clock.setFixedTime(new Date(2026, 7, 10, 12));
    // Written past the import, so the lines stay text: the keys on a todo's embed are below.
    await writeFile(join(vault, "Agent.md"), body);
    if (vim === "on") {
      await openApp(page);
      await openNote(page, "Agent");
      return;
    }
    // A phone opens on the Today page, so the note comes by its URL, the same on both.
    await page.goto("/?note=Agent.md");
    const line = page.locator(".cm-line", { hasText: body });
    await expect(line).toBeVisible({ timeout: 15_000 });
    await line.click();
  }

  /** CodeMirror's own handle on the view, the one `EditorView.findFromDOM` reads. */
  type Tiled = { cmTile: { root: { view: { state: { doc: { toString(): string } } } } } };
  const buffer = (page: Page) =>
    page
      .locator(".cm-content")
      .evaluate((el) => (el as unknown as Tiled).cmTile.root.view.state.doc.toString());

  /** Waits for `want` under the frontmatter block the first save writes, on disk and back in the buffer. */
  async function landed(page: Page, vault: string, want: string) {
    const disk = () => noteText(vault, "Agent.md");
    await expect.poll(async () => bodyOf(await disk())).toBe(want);
    // A key pressed before the save's reply reaches the buffer takes another path.
    await expect.poll(async () => (await buffer(page)) === (await disk())).toBe(true);
  }

  async function agentKey(page: Page, vault: string, body: string, steps: Step[]) {
    await openAgent(page, vault, body, "on");
    const saved = async () => bodyOf(await noteText(vault, "Agent.md"));
    for (const [keys, want] of steps) {
      for (const key of keys.split(" ")) await page.keyboard.press(key);
      if (typeof want === "string") {
        await landed(page, vault, want);
        continue;
      }
      await expect(page.getByTestId("notice")).toHaveText(`Nothing moved: ${want.refused}`);
      // A marker typed after the refusal, so the saved line shows whether the press changed it.
      for (const key of ["A", "!", "Escape"]) await page.keyboard.press(key);
      await expect.poll(saved).toBe(`${body}!`);
    }
  }

  const CLIENT = { refused: "the agent skips client work" };
  const once = (saved: string | { refused: string }): Step[] => [[`Shift+G ${AGENT}`, saved]];
  const twice = (body: string, tagged: string): Step[] => [
    [`Shift+G ${AGENT}`, tagged],
    [AGENT, body],
  ];
  const CASES: [string, string, Step[]][] = [
    [
      "A4 A7 with vim on adds #agent at the end of the words, before the fields",
      "\t- [ ] call  [[a 📅 b]] 📅 2026-10-20 ^blk1",
      once("\t- [ ] call  [[a 📅 b]] #agent 📅 2026-10-20 ^blk1"),
    ],
    [
      "A4 A7 on a [ ] todo carrying #agent takes out the tag and one space",
      "\t- [ ]  call #agent 📅 2026-10-20 ^blk1",
      once("\t- [ ]  call 📅 2026-10-20 ^blk1"),
    ],
    [
      "A4 on a doing todo carrying #agent leaves it and says it is with the agent",
      "- [/] call #agent",
      once({ refused: "that todo is already with the agent" }),
    ],
    [
      "A4 adds #agent to a done todo lacking it",
      "- [x] call ✅ 2026-10-16",
      once("- [x] call #agent ✅ 2026-10-16"),
    ],
    [
      "A5 refuses a #client todo, even one carrying #agent",
      "- [ ] call #client #agent",
      once(CLIENT),
    ],
    [
      "A5 refuses a todo two steps under a #client todo",
      "- [ ] big #client\n  - [ ] part\n    - [ ] call",
      once(CLIENT),
    ],
    [
      "#1445 adds #agent to a todo past a heading under a #client todo",
      "- [ ] big #client\n## Other\n  - [ ] call",
      once("- [ ] big #client\n## Other\n  - [ ] call #agent"),
    ],
    [
      "#1445 adds #agent to a todo past a plain list item under a #client todo",
      "- [ ] big #client\n- plain\n  - [ ] call",
      once("- [ ] big #client\n- plain\n  - [ ] call #agent"),
    ],
    [
      "#1445 refuses a fenced todo line, which no worker reads",
      "- [ ] big\n  ```\n  - [ ] call",
      once({ refused: "that line is code" }),
    ],
    [
      "A5 adds #agent under #client prose, only a todo passing client down",
      "big #client\n  - [ ] call",
      once("big #client\n  - [ ] call #agent"),
    ],
    [
      "I6 adds #agent beside a #client sibling",
      "- [ ] big #client\n- [ ] call",
      once("- [ ] big #client\n- [ ] call #agent"),
    ],
    [
      "I6 adds #agent under a parent whose other part is #client",
      "- [ ] big\n  - [ ] other #client\n  - [ ] call",
      once("- [ ] big\n  - [ ] other #client\n  - [ ] call #agent"),
    ],
    [
      "A6 on a plain line makes it an open todo, then tags it",
      "call ada",
      once(`- [ ] call ada #agent ➕ ${TODAY}`),
    ],
    [
      "I4 reads #agents and #agent/x as other tags, adding #agent beside them",
      "- [ ] call #agents #agent/x 📅 2026-10-20",
      once("- [ ] call #agents #agent/x #agent 📅 2026-10-20"),
    ],
    // `f c` onto the words, mid-line, and `x` after the press cuts whatever it is on.
    [
      "I1 leaves the cursor on its character",
      "- [ ] call 📅 2026-10-20",
      [
        [`0 f c ${AGENT}`, "- [ ] call #agent 📅 2026-10-20"],
        ["x", "- [ ] all #agent 📅 2026-10-20"],
      ],
    ],
    // The first save puts a frontmatter block above a line the press rewrote from its start (#2098).
    [
      "I1 one u takes back the whole of it on a plain line, the save's block staying",
      "call ada",
      [
        [`Shift+G ${AGENT}`, `- [ ] call ada #agent ➕ ${TODAY}`],
        ["u", "call ada"],
        ["Control+r", `- [ ] call ada #agent ➕ ${TODAY}`],
      ],
    ],
    [
      "#2098 a bullet typed at the start of a note with no frontmatter, then u, gives the line back",
      "call ada",
      [
        ["Shift+I - Space Escape", "- call ada"],
        ["u", "call ada"],
      ],
    ],
    [
      "A7 reads 2^10 as words, not a block id",
      "- [ ] compute 2^10",
      once("- [ ] compute 2^10 #agent"),
    ],
    [
      "A7 twice on 2^10 gives the line back byte for byte",
      "- [ ] compute 2^10",
      twice("- [ ] compute 2^10", "- [ ] compute 2^10 #agent"),
    ],
    [
      "A7 twice on a field hard against the words gives the line back byte for byte",
      "- [ ] foo📅 2026-10-20",
      twice("- [ ] foo📅 2026-10-20", "- [ ] foo📅 2026-10-20 #agent"),
    ],
    [
      "A7 twice on words hard against two fields puts #agent past both and gives the line back",
      "- [ ] foo📅 2026-10-20 ⏳ 2026-10-21 ^blk1",
      twice(
        "- [ ] foo📅 2026-10-20 ⏳ 2026-10-21 ^blk1",
        "- [ ] foo📅 2026-10-20 ⏳ 2026-10-21 #agent ^blk1",
      ),
    ],
    [
      "B adds #agent past a code span holding #agent, the span untouched",
      "- [ ] run `grep #agent log`",
      once("- [ ] run `grep #agent log` #agent"),
    ],
    [
      "B adds #agent past a link holding #agent, the link untouched",
      "- [ ] read [[notes#agent]]",
      once("- [ ] read [[notes#agent]] #agent"),
    ],
    [
      "B adds #agent past a URL ending #agent, the URL untouched",
      "- [ ] see https://a.io/p#agent",
      once("- [ ] see https://a.io/p#agent #agent"),
    ],
    [
      "B on a doing todo with #agent only in a span adds the tag",
      "- [/] run `grep #agent log`",
      once("- [/] run `grep #agent log` #agent"),
    ],
    ["A10 vim's own @ still replays a macro", "abc", [["g g 0 q a x q @ a", "c"]]],
  ];
  for (const [name, body, steps] of CASES) {
    test(name, async ({ page, stack }) => agentKey(page, stack.vault, body, steps));
  }

  for (const [kind, device] of [
    ["with vim off", {}],
    ["on a phone", phone],
  ] as const) {
    test.describe(kind, () => {
      test.use(device);

      // A phone has no undo on the screen: ctrl+z stands in for its keyboard's, the same buffer path.
      test("#2098 the palette's agent row on a plain line, then ctrl+z, gives the line back", async ({
        page,
        stack,
      }) => {
        await openAgent(page, stack.vault, "call ada", "off");
        await page.keyboard.press("Control+Shift+P");
        await page.getByRole("option", { name: /^Send this todo to the agent/ }).click();
        await landed(page, stack.vault, `- [ ] call ada #agent ➕ ${TODAY}`);
        await page.keyboard.press("Control+z");
        await landed(page, stack.vault, "call ada");
      });

      test("#2098 a bullet typed at the start of a note with no frontmatter, then ctrl+z, gives the line back", async ({
        page,
        stack,
      }) => {
        await openAgent(page, stack.vault, "call ada", "off");
        await page.keyboard.press("Home");
        await page.keyboard.type("- ");
        await landed(page, stack.vault, "- call ada");
        await page.keyboard.press("Control+z");
        await landed(page, stack.vault, "call ada");
      });
    });
  }
});

test.describe("the todo keys on a todo's embed", () => {
  /** Every todo in the store, as `GET /api/todos` renders each one, a line apiece. */
  async function store(url: string): Promise<string> {
    const hits = (await (await fetch(`${url}/api/todos`)).json()) as { text: string }[];
    return hits.map((hit) => hit.text).join("\n");
  }

  /** Embed.md holding one imported todo, open with vim's cursor on its embed; answers the note. */
  async function onEmbed(page: Page, vault: string, line: string): Promise<string> {
    await vaultWith(vault, { "Embed.md": `# Embed\n\n${line}\n` });
    const note = await noteText(vault, "Embed.md");
    expect(note).toMatch(/^!\[\[kt-[0-9a-f]{6}\]\]$/m);
    await openApp(page);
    await openNote(page, "Embed");
    for (const key of ["/", "k", "t", "-", "Enter"]) await page.keyboard.press(key);
    return note;
  }

  for (const [keys, line, want] of [
    ["@", "- [ ] call ada 📅 2026-10-20", /^- \[ \] call ada #agent .*📅 2026-10-20/m],
    ["x", "- [ ] call ada", /^- \[\/\] call ada /m],
    ["sx", "- [ ] call ada", /^- \[x\] call ada /m],
    ["sw", "- [ ] call ada", /^- \[w\] call ada /m],
  ] as const) {
    test(`Space ${keys} acts on the todo in the store and leaves the embed as it was`, async ({
      page,
      stack,
    }) => {
      const note = await onEmbed(page, stack.vault, line);
      await leader(page, keys);
      await expect.poll(() => store(stack.url)).toMatch(want);
      expect(await noteText(stack.vault, "Embed.md")).toBe(note);
    });
  }

  test("Space i stamps nothing on an embed", async ({ page, stack }) => {
    const note = await onEmbed(page, stack.vault, "- [ ] call ada");
    await leader(page, "i");
    // A real key after it: once its write lands, a write Space i sent would have too.
    await leader(page, "x");
    await expect.poll(() => store(stack.url)).toMatch(/^- \[\/\] call ada /m);
    expect(await noteText(stack.vault, "Embed.md")).toBe(note);
  });
});
