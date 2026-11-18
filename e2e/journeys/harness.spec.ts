import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect as plainExpect, test as plainTest } from "@playwright/test";
import { fixtureVault, root } from "../harness/paths.ts";
import {
  type Backend,
  backendEnv,
  createDatabase,
  endWarm,
  expect,
  fork,
  killGroup,
  listening,
  serve,
  stop,
  test,
  warmArgs,
} from "../harness/stack.ts";

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

test("a forked backend starts at least a second sooner than a cold one, and stops whole", async ({
  warm,
}) => {
  const startup = async (start: (dir: string, env: Record<string, string>) => Backend) => {
    const dir = await mkdtemp(join(tmpdir(), "kasten-e2e-"));
    await cp(fixtureVault, join(dir, "vault"), { recursive: true });
    const db = `t_${randomBytes(6).toString("hex")}`;
    await createDatabase(db);
    const began = performance.now();
    const backend = start(dir, backendEnv(dir, db));
    try {
      await listening(backend, []);
      return performance.now() - began;
    } finally {
      await stop(backend);
      await rm(dir, { recursive: true, force: true });
      await expect.poll(() => alive(backend.pid ?? 0)).toBe(false);
    }
  };
  const uvicorn = ["kasten_backend.main:app", "--host", "127.0.0.1", "--port", "0"];
  const cold = await startup((dir, env) =>
    spawn("uv", ["run", "--no-sync", "--project", root, "uvicorn", ...uvicorn], {
      cwd: dir,
      detached: true,
      env: { ...process.env, ...env },
    }),
  );
  const forked = await startup((dir, env) => fork(warm, dir, env));
  console.log(`backend start: cold ${Math.round(cold)} ms, forked ${Math.round(forked)} ms`);
  expect(cold - forked).toBeGreaterThan(1000);
});

test("a forked backend reads its settings from its own test's env", async ({ warm }) => {
  const dir = await mkdtemp(join(tmpdir(), "kasten-e2e-"));
  await cp(fixtureVault, join(dir, "elsewhere"), { recursive: true });
  await writeFile(join(dir, "elsewhere", "only-here.md"), "# here\n");
  const db = `t_${randomBytes(6).toString("hex")}`;
  await createDatabase(db);
  const env = { ...backendEnv(dir, db), KASTEN_VAULT_PATH: join(dir, "elsewhere") };
  const backend = fork(warm, dir, env);
  try {
    const port = await listening(backend, []);
    const files = await (await fetch(`http://127.0.0.1:${port}/api/files`)).json();
    expect(files).toContain("only-here.md");
  } finally {
    await stop(backend);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a forked backend that dies at start fails its test with its log and code", async ({
  warm,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "kasten-e2e-"));
  const log: string[] = [];
  const env = { ...backendEnv(dir, "unused"), KASTEN_DATABASE_URL: "no-url" };
  try {
    await expect(listening(fork(warm, dir, env), log)).rejects.toThrow(
      /exited with 1:[\s\S]*Could not parse SQLAlchemy URL/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a forked backend a signal kills fails with the signal, and its stop returns", async ({
  warm,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "kasten-e2e-"));
  const backend = fork(warm, dir, backendEnv(dir, "t_never_made"));
  try {
    const started = listening(backend, []);
    await expect.poll(() => backend.pid).toBeDefined();
    killGroup(backend.pid ?? 0, "SIGKILL");
    await expect(started).rejects.toThrow(/exited with SIGKILL/);
    await expect(stop(backend).then(() => "stopped")).resolves.toBe("stopped");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

plainTest("a warm parent that died fails the next start, and its stop returns", async () => {
  const socket = join(await mkdtemp(join(tmpdir(), "kasten-warm-")), "socket");
  const parent = spawn("uv", warmArgs(socket), {
    detached: true,
    stdio: ["pipe", "pipe", "inherit"],
  });
  await once(parent.stdout, "data");
  killGroup(parent.pid ?? 0, "SIGKILL");
  await once(parent, "exit");
  const dir = await mkdtemp(join(tmpdir(), "kasten-e2e-"));
  const orphan = fork(socket, dir, backendEnv(dir, "t_never_made"));
  await plainExpect(listening(orphan, [])).rejects.toThrow(
    /warm backend: \w+ ECONN(REFUSED|RESET)/,
  );
  await plainExpect(stop(orphan).then(() => "stopped")).resolves.toBe("stopped");
  await plainExpect(endWarm(parent).then(() => "ended")).resolves.toBe("ended");
  await rm(dir, { recursive: true, force: true });
});

plainTest("a warm parent ends when its worker closes its stdin", async () => {
  const socket = join(await mkdtemp(join(tmpdir(), "kasten-warm-")), "socket");
  const parent = spawn("uv", warmArgs(socket), { stdio: ["pipe", "pipe", "inherit"] });
  const [ready] = await once(parent.stdout, "data");
  plainExpect(String(ready).trim()).toBe("ready");
  await endWarm(parent);
  plainExpect(parent.exitCode).toBe(0);
});

plainTest("a backend that dies at start fails its test with the backend's log", async () => {
  const log: string[] = [];
  const dying = spawn("sh", ["-c", "echo no database here >&2; exit 3"]);
  await plainExpect(listening(dying, log)).rejects.toThrow(/exited with 3:\nno database here/);
});

plainTest("a backend a signal kills at start fails its test with the signal", async () => {
  const dying = spawn("sh", ["-c", "kill -9 $$"]);
  await plainExpect(listening(dying, [])).rejects.toThrow(/exited with SIGKILL/);
});

plainTest("stopping a backend a signal killed returns at once", async () => {
  const killed = spawn("sleep", ["60"], { detached: true });
  killed.kill("SIGKILL");
  await once(killed, "exit");
  await plainExpect(
    Promise.race([
      stop(killed).then(() => "stopped"),
      new Promise((done) => setTimeout(() => done("hung"), 2000)),
    ]),
  ).resolves.toBe("stopped");
});

plainTest("stopping a backend whose parent died ends the child it left", async () => {
  const parent = spawn("sh", ["-c", "sleep 60 & echo $!; kill -9 $$"], { detached: true });
  const [out] = await once(parent.stdout, "data");
  await once(parent, "exit");
  await stop(parent);
  const child = Number(String(out).trim());
  await plainExpect.poll(() => alive(child), { timeout: 2000 }).toBe(false);
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return false;
  }
}

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
  try {
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
  } finally {
    proxy.closeAllConnections();
    proxy.close();
    backend.closeAllConnections();
    backend.close();
  }
});

plainTest("killing a process group that already left throws nothing", async () => {
  const gone = spawn("true", { detached: true });
  await once(gone, "exit");
  plainExpect(() => killGroup(gone.pid ?? 0, "SIGTERM")).not.toThrow();
});
