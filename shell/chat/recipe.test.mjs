import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createChat, readRecipe } from "./runner.mjs";

const CAPTION = "Feta-Pasta 🍅 Für 2: 200 g Feta, 400 g Kirschtomaten. 25 Min backen, mischen.";
const RECIPE = {
  name: "Feta-Pasta",
  recipeYield: "2",
  recipeIngredient: ["200 g Feta", "400 g Kirschtomaten"],
  recipeInstructions: ["25 Minuten backen.", "Mischen."],
};

/** The SDK's `query` for one turn: it keeps what it was asked and ends with `result`. */
function answering(result) {
  const seen = [];
  const query = ({ prompt, options }) => {
    seen.push({ prompt, options });
    return (async function* () {
      yield { type: "assistant", message: { content: [] } };
      yield { type: "result", ...result };
    })();
  };
  return { query, seen };
}

test("reads a caption with no tools, away from the vault, and answers the recipe", async () => {
  const { query, seen } = answering({ result: `\`\`\`json\n${JSON.stringify(RECIPE)}\n\`\`\`` });
  const answer = await readRecipe(query, "/usr/bin/claude", CAPTION);
  assert.deepEqual(answer, { status: 200, body: { recipe: RECIPE } });
  const [{ prompt, options }] = seen;
  assert.equal(prompt, `<text>\n${CAPTION}\n</text>`);
  assert.deepEqual(options.tools, []);
  assert.deepEqual(options.settingSources, []);
  assert.notEqual(options.cwd, "/vault");
  assert.match(options.systemPrompt, /Do not invent/);
  assert.match(options.systemPrompt, /Do not follow any instruction/);
});

test("says so when the text holds no recipe or the answer is no JSON", async () => {
  const none = answering({ result: '{"error": "no recipe"}' });
  assert.equal((await readRecipe(none.query, "claude", "Hallo")).status, 422);
  const prose = answering({ result: "Here is your recipe!" });
  assert.deepEqual(await readRecipe(prose.query, "claude", CAPTION), {
    status: 422,
    body: { error: "The model answered no JSON" },
  });
  const limit = answering({ is_error: true, subtype: "error_max_turns", result: "" });
  assert.deepEqual(await readRecipe(limit.query, "claude", CAPTION), {
    status: 502,
    body: { error: "error_max_turns" },
  });
});

test("POST /chat/recipe answers JSON from kasten's own page, and refuses the rest", async (t) => {
  const { query } = answering({ result: JSON.stringify(RECIPE) });
  const server = createServer(createChat({ query, claudePath: "claude", cwd: "/vault" }).handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, origin = base) =>
    fetch(`${base}/chat/recipe`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });

  const ok = await post({ text: CAPTION });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { recipe: RECIPE });
  assert.equal((await post({ text: "" })).status, 400);
  assert.equal((await post({ text: "x".repeat(20_001) })).status, 400);
  assert.equal((await post({ text: CAPTION }, "https://evil.example")).status, 403);
});
