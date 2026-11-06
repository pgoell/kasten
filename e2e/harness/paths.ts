import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const root = resolve(import.meta.dirname, "../..");
export const fixtureVault = resolve(import.meta.dirname, "../vault");

export async function compose(project: string, ...args: string[]): Promise<string> {
  const files = ["-f", "compose.yaml", "-f", "e2e/harness/compose.e2e.yml"];
  const { stdout } = await run("docker", ["compose", "-p", project, ...files, ...args], {
    cwd: root,
  });
  return stdout;
}

export function databaseUrl(name: string): string {
  return `postgresql+psycopg://kasten:kasten@127.0.0.1:${process.env.E2E_DB_PORT}/${name}`;
}
