import { readFileSync } from "node:fs";
import path from "node:path";

/** Comments dropped, because several of them name the very directives under test. */
export const NGINX = readFileSync(path.join(import.meta.dirname, "../nginx.conf"), "utf8").replace(
  /#.*$/gm,
  "",
);

/** The server block's own directives, and each location's body, keyed by what follows `location`. */
export function blocks(): { server: string; locations: Map<string, string> } {
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
