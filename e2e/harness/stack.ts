import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { test as base } from "@playwright/test";
import { compose, databaseUrl, fixtureVault, root } from "./paths.ts";

export { expect } from "@playwright/test";

export type Stack = { url: string; vault: string };

/** What `listening` and `stop` read of a backend, spawned or forked. */
export type Backend = Pick<ChildProcess, "pid" | "exitCode" | "signalCode" | "once"> & {
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
};

/** Each test gets its own vault copy, database, backend and proxy, so tests run side by side. */
export const test = base.extend<{ stack: Stack }, { warm: string }>({
  // One per worker: forking a backend skips the 2 s import of its libraries (#1980).
  warm: [
    async ({}, use) => {
      const socket = join(await mkdtemp(join(tmpdir(), "kasten-warm-")), "socket");
      const parent = spawn("uv", warmArgs(socket), { stdio: ["pipe", "pipe", "inherit"] });
      const [ready] = await Promise.race([
        once(parent.stdout, "data"),
        once(parent, "exit").then(([code]) => {
          throw new Error(`warm backend exited with ${code}`);
        }),
      ]);
      if (String(ready).trim() !== "ready") throw new Error(`warm backend said ${ready}`);
      await use(socket);
      await endWarm(parent);
      await rm(dirname(socket), { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  stack: async ({ warm }, use, testInfo) => {
    const dir = await mkdtemp(join(tmpdir(), "kasten-e2e-"));
    const vault = join(dir, "vault");
    await cp(fixtureVault, vault, { recursive: true });
    const db = `t_${randomBytes(6).toString("hex")}`;
    await createDatabase(db);
    const log: string[] = [];
    const backend = fork(warm, dir, backendEnv(dir, db));
    let proxy: Server | undefined;
    try {
      const apiPort = await listening(backend, log);
      proxy = await serve(apiPort, Number(process.env.E2E_WEB_PORT));
      const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
      stacks.set(vault, url);
      await importTodos(url);
      await use({ url, vault });
    } finally {
      stacks.delete(vault);
      proxy?.closeAllConnections();
      proxy?.close();
      await stop(backend);
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("backend.log", { body: log.join(""), contentType: "text/plain" });
      }
      await rm(dir, { recursive: true, force: true });
    }
  },
  baseURL: async ({ stack }, use) => use(stack.url),
});

/** Each running stack's address by its vault, so a note written later can be imported too. */
export const stacks = new Map<string, string>();

/** Moves the vault's todo lines into the store, as the production import did (#2191). */
export async function importTodos(url: string): Promise<void> {
  const answer = await fetch(`${url}/api/todos/import?write=true`, { method: "POST" });
  if (!answer.ok) throw new Error(`todo import answered ${answer.status}: ${await answer.text()}`);
}

/** Ends a warm parent by closing its stdin; one that died already returns at once. */
export async function endWarm(parent: ChildProcess): Promise<void> {
  if (parent.exitCode !== null || parent.signalCode !== null) return;
  const exited = once(parent, "exit");
  parent.stdin?.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
  parent.stdin?.end();
  await exited;
}

export function warmArgs(socket: string): string[] {
  return [
    "run",
    "--no-sync",
    "--project",
    root,
    "python",
    join(root, "e2e/warm_backend.py"),
    socket,
  ];
}

export function backendEnv(dir: string, db: string): Record<string, string> {
  return {
    KASTEN_VAULT_PATH: join(dir, "vault"),
    KASTEN_DATABASE_URL: databaseUrl(db),
    KASTEN_TOKENS_PATH: join(dir, "tokens.json"),
    KASTEN_UPLOAD_PATH: join(dir, "uploads"),
    KASTEN_TEXT_CACHE_PATH: join(dir, "text"),
    KASTEN_RECEIPTS_PATH: join(dir, "receipts"),
    KASTEN_HERDR_SESSIONS_PATH: join(dir, "herdr"),
  };
}

/** A backend the warm parent forks; its socket carries a `pid` line, the output, then NUL and the exit. */
export function fork(socket: string, cwd: string, env: Record<string, string>): Backend {
  const forked = Object.assign(new EventEmitter(), {
    pid: undefined as number | undefined,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stdout: new PassThrough(),
    stderr: null,
  });
  let head = "";
  let tail: string | undefined;
  const link = connect(socket, () => link.write(`${JSON.stringify({ env, cwd })}\n`));
  link.on("data", (chunk: Buffer) => {
    let text = chunk.toString();
    if (forked.pid === undefined) {
      head += text;
      const found = /^pid (\d+)\n/.exec(head);
      if (!found) return;
      forked.pid = Number(found[1]);
      text = head.slice(found[0].length);
    }
    if (tail === undefined && text.includes("\0")) {
      tail = text.slice(text.indexOf("\0") + 1);
      text = text.slice(0, text.indexOf("\0"));
    } else if (tail !== undefined) {
      tail += text;
      text = "";
    }
    if (text) forked.stdout.write(text);
  });
  // A dead warm parent shows as a failed connect, or a close with no exit line.
  link.on("error", (error) => forked.stdout.write(`warm backend: ${error.message}\n`));
  link.on("close", () => {
    const ended = /^exit (\S+)/.exec(tail ?? "")?.[1];
    if (forked.pid !== undefined && !ended)
      forked.stdout.write("warm backend: closed with no exit line\n");
    if (ended && /^-?\d+$/.test(ended)) forked.exitCode = Number(ended);
    else forked.signalCode = (ended ?? "SIGKILL") as NodeJS.Signals;
    forked.emit("exit", forked.exitCode, forked.signalCode);
  });
  return forked;
}

// Two copies of one template at the same moment can meet "being accessed by other users".
export async function createDatabase(name: string): Promise<void> {
  for (let i = 0; ; i++) {
    const sql = `CREATE DATABASE ${name} TEMPLATE e2e_template`;
    const made = await compose(
      process.env.E2E_PROJECT ?? "",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "kasten",
      "-d",
      "kasten_dev",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ).then(
      () => true,
      (error: Error) => {
        if (i >= 20) throw error;
        return false;
      },
    );
    if (made) return;
    await new Promise((done) => setTimeout(done, 100 + Math.random() * 300));
  }
}

export function listening(backend: Backend, log: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`backend did not start in 60 s:\n${log.join("")}`)),
      60_000,
    );
    const read = (chunk: Buffer) => {
      log.push(chunk.toString());
      const found = /Uvicorn running on http:\/\/127\.0\.0\.1:(\d+)/.exec(log.join(""));
      if (found) {
        clearTimeout(timer);
        resolve(Number(found[1]));
      }
    };
    backend.stdout?.on("data", read);
    backend.stderr?.on("data", read);
    backend.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`backend exited with ${code ?? signal}:\n${log.join("")}`));
    });
  });
}

// Plays Caddy's part in production: `/api/*`, `/agent/*` and the lists app's `/share/*` to the backend, the rest to nginx.
export function serve(apiPort: number, webPort: number): Promise<Server> {
  const server = createServer((req, res) => {
    const backend = ["/api/", "/agent/", "/share/"].some((head) => req.url?.startsWith(head));
    const port = backend ? apiPort : webPort;
    const upstream = request(
      { host: "127.0.0.1", port, method: req.method, path: req.url, headers: req.headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", () => res.destroy());
    // A page that leaves holds `/api/events` open otherwise, and uvicorn waits for it before it stops.
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// The whole process group, since `uv run` starts uvicorn as its child.
export async function stop(backend: Backend): Promise<void> {
  if (backend.pid === undefined) return;
  // A `uv` that died, by a code or a signal, can leave uvicorn running in its group.
  if (backend.exitCode !== null || backend.signalCode !== null) {
    killGroup(backend.pid, "SIGKILL");
    return;
  }
  const exited = new Promise((done) => backend.once("exit", done));
  const pid = backend.pid;
  killGroup(pid, "SIGTERM");
  const late = setTimeout(() => killGroup(pid, "SIGKILL"), 10_000);
  await exited;
  clearTimeout(late);
}

// A group that exits between the check and the kill is no fault.
export function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
