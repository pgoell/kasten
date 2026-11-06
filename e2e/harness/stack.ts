import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "@playwright/test";
import { compose, databaseUrl, fixtureVault, root } from "./paths.ts";

export { expect } from "@playwright/test";

export type Stack = { url: string; vault: string };

/** Each test gets its own vault copy, database, backend and proxy, so tests run side by side. */
export const test = base.extend<{ stack: Stack }>({
  stack: async ({}, use, testInfo) => {
    const dir = await mkdtemp(join(tmpdir(), "kasten-e2e-"));
    const vault = join(dir, "vault");
    await cp(fixtureVault, vault, { recursive: true });
    const db = `t_${randomBytes(6).toString("hex")}`;
    await createDatabase(db);
    const log: string[] = [];
    const backend = spawn(
      "uv",
      [
        "run",
        "--no-sync",
        "--project",
        root,
        "uvicorn",
        "kasten_backend.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ],
      {
        cwd: dir,
        detached: true,
        env: {
          ...process.env,
          KASTEN_VAULT_PATH: vault,
          KASTEN_DATABASE_URL: databaseUrl(db),
          KASTEN_TOKENS_PATH: join(dir, "tokens.json"),
          KASTEN_UPLOAD_PATH: join(dir, "uploads"),
          KASTEN_TEXT_CACHE_PATH: join(dir, "text"),
          KASTEN_RECEIPTS_PATH: join(dir, "receipts"),
        },
      },
    );
    let proxy: Server | undefined;
    try {
      const apiPort = await listening(backend, log);
      proxy = await serve(apiPort, Number(process.env.E2E_WEB_PORT));
      await use({ url: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`, vault });
    } finally {
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

// Two copies of one template at the same moment can meet "being accessed by other users".
async function createDatabase(name: string): Promise<void> {
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

export function listening(backend: ChildProcess, log: string[]): Promise<number> {
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

// Plays Caddy's part in production: `/api/*` to the backend, the rest to nginx.
export function serve(apiPort: number, webPort: number): Promise<Server> {
  const server = createServer((req, res) => {
    const port = req.url?.startsWith("/api/") ? apiPort : webPort;
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
export async function stop(backend: ChildProcess): Promise<void> {
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
