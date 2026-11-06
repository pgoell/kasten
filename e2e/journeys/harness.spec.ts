import { spawn } from "node:child_process";
import { expect as plainExpect, test as plainTest } from "@playwright/test";
import { expect, listening, test } from "../harness/stack.ts";

// Run side by side: on a shared stack whichever ran second would list the first one's note.
for (const name of ["first", "second"]) {
  test(`the ${name} of two tests sees only its own vault`, async ({ request }) => {
    const made = await request.post(`/api/files/isolation-${name}.md`, {
      data: { content: "# mine\n" },
    });
    expect(made.status()).toBe(201);
    const files: string[] = await (await request.get("/api/files")).json();
    expect(files.filter((path) => path.startsWith("isolation-"))).toEqual([`isolation-${name}.md`]);
  });
}

plainTest("a backend that dies at start fails its test with the backend's log", async () => {
  const log: string[] = [];
  const dying = spawn("sh", ["-c", "echo no database here >&2; exit 3"]);
  await plainExpect(listening(dying, log)).rejects.toThrow(/exited with 3:\nno database here/);
});
