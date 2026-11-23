import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { compose, composeFiles, DOWN, databaseUrl, root } from "./paths.ts";

const run = promisify(execFile);

/** Starts Postgres and nginx for the run and migrates the template every test's database copies. */
export default async function globalSetup() {
  const project = `kasten-e2e-${randomBytes(4).toString("hex")}`;
  process.env.E2E_PROJECT = project;
  const watcher = watch(project);
  const stop = async () => {
    await compose(project, ...DOWN);
    watcher.kill();
  };
  try {
    await compose(project, "up", "-d", "--wait");
    process.env.E2E_DB_PORT = await port(project, "db", 5432);
    process.env.E2E_WEB_PORT = await port(project, "web", 3000);
    await tcpReady(project);
    await compose(project, "exec", "-T", "db", "createdb", "-U", "kasten", "e2e_template");
    await run("uv", ["run", "alembic", "upgrade", "head"], {
      cwd: `${root}/backend`,
      env: { ...process.env, KASTEN_DATABASE_URL: databaseUrl("e2e_template") },
    });
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}

// Teardown runs only if the runner ends on its own; a SIGKILL'd runner would leave the project up
// for good (#2284). This watcher sits in its own session, so a kill of the runner's group spares it.
function watch(project: string) {
  const down = `docker compose -p "$2" ${[...composeFiles, ...DOWN].join(" ")}`;
  const watcher = spawn(
    "sh",
    [
      "-c",
      `while kill -0 "$1" 2>/dev/null; do sleep 1; done; ${down}`,
      "sh",
      String(process.pid),
      project,
    ],
    {
      cwd: root,
      detached: true,
      stdio: "ignore",
    },
  );
  watcher.unref();
  return watcher;
}

async function port(project: string, service: string, inner: number): Promise<string> {
  const out = await compose(project, "port", service, String(inner));
  return out.trim().split(":").at(-1) ?? "";
}

// The healthcheck asks over the socket, which the image's init server answers before it restarts.
async function tcpReady(project: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const ready = await compose(
      project,
      "exec",
      "-T",
      "db",
      "pg_isready",
      "-h",
      "127.0.0.1",
      "-U",
      "kasten",
      "-q",
    ).then(
      () => true,
      () => false,
    );
    if (ready) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("Postgres never answered over TCP");
}
