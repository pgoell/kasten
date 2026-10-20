import { POLICY } from "@/lib/csp";
import { blocks } from "./nginx-conf";

const HOST_GATE = /\bif\s*\(\s*\$host\s*!=\s*liste\.pgoell\.com\s*\)\s*\{\s*return\s+404\s*;\s*\}/;

/** Whitespace and a trailing semicolon are spelling, not policy. */
function normalise(policy: string): string {
  return policy
    .split(";")
    .map((directive) => directive.trim().replace(/\s+/g, " "))
    .filter((directive) => directive !== "")
    .join("; ");
}

describe("the lists app's host", () => {
  it("serves the lists app on the share host alone", () => {
    const { locations } = blocks();
    const gated = Object.fromEntries(
      ["= /lists.html", "= /lists.webmanifest", "= /lists-sw.js"].map((key) => [
        key,
        HOST_GATE.test(locations.get(key) ?? ""),
      ]),
    );
    expect(gated).toEqual({
      "= /lists.html": true,
      "= /lists.webmanifest": true,
      "= /lists-sw.js": true,
    });
  });

  it("sends the lists page with the app's policy", () => {
    const body = blocks().locations.get("= /lists.html") ?? "";
    const policy = body.match(/add_header\s+Content-Security-Policy\s+"([^"]*)"/)?.[1] ?? "";
    expect(normalise(policy)).toBe(normalise(POLICY));
  });
});
