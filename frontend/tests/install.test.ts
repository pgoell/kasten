import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { applyInstall, installFor } from "@/lib/install";

const FRONTEND = path.join(import.meta.dirname, "..");
const PUBLIC = path.join(FRONTEND, "public");

function manifest(address: string): { id: string; scope: string; share_target?: unknown } {
  return JSON.parse(readFileSync(path.join(PUBLIC, address), "utf8"));
}

/** `index.html`'s own head, so the tags under test are the ones that ship. */
function shippedHead(): HTMLHeadElement {
  const html = readFileSync(path.join(FRONTEND, "index.html"), "utf8");
  return new DOMParser().parseFromString(html, "text/html").head;
}

describe("the home screen install", () => {
  it("gives the capture page its own app and every other page the notebook", () => {
    expect(manifest(installFor("/capture").manifest).id).toBe("/capture");
    expect(manifest(installFor("/").manifest).id).toBe("/");
    expect(manifest(installFor("/review").manifest).id).toBe("/");
  });

  it("leaves the share target with capture alone", () => {
    expect(manifest(installFor("/capture").manifest).share_target).toBeDefined();
    expect(manifest(installFor("/").manifest).share_target).toBeUndefined();
  });

  it("ships the notebook's tags and swaps all three on the capture page", () => {
    const head = shippedHead();
    const read = () => ({
      manifest: head.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      icon: head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
      title: head.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content"),
    });

    expect(read()).toEqual(installFor("/"));
    applyInstall("/capture", head);
    expect(read()).toEqual(installFor("/capture"));
    applyInstall("/", head);
    expect(read()).toEqual(installFor("/"));
  });

  it("asks for the manifest with the session, which the login gate needs", () => {
    const link = shippedHead().querySelector('link[rel="manifest"]');
    expect(link?.getAttribute("crossorigin")).toBe("use-credentials");
  });

  it("has nginx name every manifest as one", () => {
    // nginx's mime.types has no row for `.webmanifest`, so a manifest its
    // location misses goes out as a download and installs nothing.
    const nginx = readFileSync(path.join(FRONTEND, "nginx.conf"), "utf8");
    const served = nginx.match(/location ~ (\S+) \{\s*types \{ application\/manifest\+json/)?.[1];
    if (served === undefined) throw new Error("nginx.conf has no manifest location");
    const names = readdirSync(PUBLIC).filter((name) => name.endsWith(".webmanifest"));
    expect(names).toHaveLength(2);
    for (const name of names) expect(`/${name}`).toMatch(new RegExp(served));
  });
});
