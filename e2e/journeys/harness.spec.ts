import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { expect as plainExpect, test as plainTest } from "@playwright/test";
import { expect, killGroup, listening, serve, test } from "../harness/stack.ts";

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

plainTest("a reader that leaves the proxy closes its stream to the backend", async () => {
  const backend = createServer((_req, res) =>
    res.writeHead(200, { "content-type": "text/event-stream" }).write(": open\n\n"),
  );
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const proxy = await serve((backend.address() as AddressInfo).port, 1);
  const upstreamClosed = new Promise<void>((done) =>
    backend.on("request", (req) => req.socket.on("close", () => done())),
  );
  const reader = get(`http://127.0.0.1:${(proxy.address() as AddressInfo).port}/api/events`);
  const [answer] = await once(reader, "response");
  await once(answer, "data");
  reader.destroy();
  await plainExpect(
    Promise.race([
      upstreamClosed.then(() => "closed"),
      new Promise((done) => setTimeout(() => done("open"), 2000)),
    ]),
  ).resolves.toBe("closed");
  proxy.close();
  backend.close();
});

plainTest("killing a process group that already left throws nothing", async () => {
  const gone = spawn("true", { detached: true });
  await once(gone, "exit");
  plainExpect(() => killGroup(gone.pid ?? 0, "SIGTERM")).not.toThrow();
});
