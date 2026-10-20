import { blocks } from "./nginx-conf";

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
