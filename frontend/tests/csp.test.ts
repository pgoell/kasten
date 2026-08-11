import { readFileSync } from "node:fs";
import path from "node:path";
import { devPolicy, POLICY } from "@/lib/csp";

const NGINX = readFileSync(path.join(import.meta.dirname, "../nginx.conf"), "utf8");

/** The one policy nginx serves, read back out of the block that serves the app. */
function nginxPolicy(): string {
  const found = NGINX.match(/add_header\s+Content-Security-Policy\s+"([^"]*)"/)?.[1];
  if (found === undefined) throw new Error("nginx.conf carries no Content-Security-Policy header");
  return found;
}

/** Whitespace and a trailing semicolon are spelling, not policy. */
function normalise(policy: string): string {
  return policy
    .split(";")
    .map((directive) => directive.trim().replace(/\s+/g, " "))
    .filter((directive) => directive !== "")
    .join("; ");
}

/** One directive's sources, so a test can pin the one that matters. */
function sources(policy: string, name: string): string {
  const found = normalise(policy)
    .split("; ")
    .find((directive) => directive.startsWith(`${name} `));
  if (!found) throw new Error(`no ${name} in ${policy}`);
  return found.slice(name.length + 1);
}

describe("the content security policy", () => {
  it("is the same in nginx as it is here", () => {
    // Equal, not merely containing: nginx could otherwise carry an extra source
    // nobody notices, and nginx.conf cannot import from TypeScript.
    expect(normalise(nginxPolicy())).toBe(normalise(POLICY));
  });

  it("lets production run scripts from nowhere but this origin", () => {
    // Pinned whole rather than checked for the absence of 'unsafe-inline'.
    // Adding `https:` to both copies would sail past an absence check and let a
    // book load a script from anywhere.
    expect(sources(POLICY, "script-src")).toBe("'self'");
  });

  it("adds one minted nonce and nothing else in development", () => {
    expect(sources(devPolicy("x"), "script-src")).toBe("'self' 'nonce-x'");
  });
});
