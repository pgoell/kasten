import { readFileSync } from "node:fs";
import path from "node:path";

/** Comments dropped, because several of them name the very directives under test. */
const NGINX = readFileSync(path.join(import.meta.dirname, "../nginx.conf"), "utf8").replace(
  /#.*$/gm,
  "",
);

/** The server block's own directives, and each location's body, keyed by what follows `location`. */
function blocks(): { server: string; locations: Map<string, string> } {
  const locations = new Map<string, string>();
  let server = "";
  let rest = NGINX.slice(NGINX.indexOf("{") + 1, NGINX.lastIndexOf("}"));
  for (;;) {
    const start = rest.search(/\blocation\b/);
    if (start === -1) break;
    server += rest.slice(0, start);
    const open = rest.indexOf("{", start);
    const key = rest.slice(start + "location".length, open).trim();
    // Counted rather than matched, since the manifest block nests `types { }`.
    let depth = 1;
    let end = open + 1;
    while (depth > 0) {
      if (rest[end] === "{") depth++;
      if (rest[end] === "}") depth--;
      end++;
    }
    locations.set(key, rest.slice(open + 1, end - 1));
    rest = rest.slice(end);
  }
  return { server: server + rest, locations };
}

describe("the cache headers nginx sends", () => {
  it("revalidate index.html and the unhashed public files", () => {
    // An installed app otherwise keeps a stale shell or viewport-fit.js for as
    // long as the browser's heuristic likes, since nginx sends no Cache-Control.
    const { server, locations } = blocks();
    expect(server).toMatch(/\bexpires\s+-1\s*;/);
    // Absence of `expires` and of a Cache-Control add_header, not of add_header
    // at all: the policy header in `/` has no bearing on `expires`, which every
    // block inherits unless it sets its own.
    for (const key of ["/", "/pdfjs/", "= /manifest.webmanifest", "= /sw.js"]) {
      const body = locations.get(key);
      if (body === undefined) throw new Error(`nginx.conf has no location ${key}`);
      expect(body).not.toMatch(/\bexpires\b/);
      expect(body).not.toMatch(/add_header\s+Cache-Control/);
    }
  });

  it("still cache the hashed assets for a year", () => {
    const body = blocks().locations.get("/assets/");
    if (body === undefined) throw new Error("nginx.conf has no location /assets/");
    expect(body).toMatch(/\bexpires\s+1y\s*;/);
    expect(body).toMatch(/add_header\s+Cache-Control\s+"public, immutable"/);
  });

  it("answer 404 for a missing sw.js rather than the shell", () => {
    // A 200 of index.html leaves the old worker installed; a 404 unregisters it.
    const body = blocks().locations.get("= /sw.js");
    if (body === undefined) throw new Error("nginx.conf has no location = /sw.js");
    expect(body).toMatch(/\btry_files\s+\$uri\s+=404\s*;/);
  });
});
