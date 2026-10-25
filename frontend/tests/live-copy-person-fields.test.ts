import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cycleLine, parseTodo, setStateOn, type TodoState } from "@/lib/todo";

// Off unless KASTEN_LIVE_COPY names a read-only copy of a live vault, because
// the walk reads a vault nobody here owns. KASTEN_LIVE_OUT is where the JSON of
// every todo line's parse and state changes is written, to diff main against
// the branch.
const COPY = process.env.KASTEN_LIVE_COPY ?? "";
const OUT = process.env.KASTEN_LIVE_OUT ?? "";
const TODAY = "2026-10-25";
const ID = "kt-000000";
const STATES: TodoState[] = ["open", "doing", "done", "blocked", "waiting", "review", "rejected"];

function markdownFiles(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((path) => path.endsWith(".md") && !path.split(/[\\/]/).includes(".trash"));
}

it.skipIf(!COPY)(
  "#809 A3 every todo line of the live copy through parse and every state change",
  () => {
    const perState: Record<string, number> = Object.fromEntries(STATES.map((state) => [state, 0]));
    const records: unknown[] = [];
    let total = 0;
    let withPerson = 0;

    for (const file of markdownFiles(COPY)) {
      const lines = readFileSync(join(COPY, file), "utf8").split(/\r?\n/);
      lines.forEach((text, index) => {
        const parsed = parseTodo(text);
        if (parsed === null) return;
        total += 1;
        perState[parsed.state] = (perState[parsed.state] ?? 0) + 1;
        if (text.includes("👤")) withPerson += 1;
        records.push({
          path: file,
          line: index + 1,
          text,
          parsed,
          set: Object.fromEntries(
            STATES.map((state) => [state, setStateOn(text, state, TODAY, ID)]),
          ),
          cycle: cycleLine(text, TODAY, ID),
        });
      });
    }

    writeFileSync(
      OUT,
      JSON.stringify({ counts: { perState, withPerson, total }, lines: records }, null, 1),
    );
    expect(total).toBeGreaterThan(0);
  },
);
