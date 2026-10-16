import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Mock } from "vitest";
import { registerServiceWorker } from "@/lib/service-worker";
import { renderServiceWorker, serviceWorker } from "../sw/plugin";

const ORIGIN = "https://kasten.test";
const ASSETS = ["/assets/index-abc.js", "/assets/index-def.css"];

type Listener = (event: unknown) => void;

/** A Map per cache, keyed by absolute URL, the way the worker's `"/"` and a Request have to agree. */
function fakeCaches() {
  const store = new Map<string, Map<string, Response>>();
  const key = (request: RequestInfo) =>
    new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
  const open = async (name: string) => {
    let entries = store.get(name);
    if (!entries) {
      entries = new Map();
      store.set(name, entries);
    }
    const cache = entries;
    return {
      match: async (request: RequestInfo) => cache.get(key(request))?.clone(),
      put: async (request: RequestInfo, response: Response) => {
        cache.set(key(request), response);
      },
    };
  };
  return {
    store,
    open,
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
}

/** A Response the way a same-origin fetch hands it to a worker: `new Response` says `default`. */
function basic(body: string, status = 200, type = "text/html"): Response {
  const response = new Response(body, { status, headers: { "Content-Type": type } });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

/** What a navigation's `redirect: "manual"` turns a 302 to the sign-in page into. */
function opaqueRedirect(): Response {
  const response = new Response(null);
  Object.defineProperties(response, {
    type: { value: "opaqueredirect" },
    status: { value: 0 },
    ok: { value: false },
  });
  return response;
}

/** `new Request` refuses `mode: "navigate"`, so it is set on the instance. */
function navigation(pathname: string): Request {
  const request = new Request(new URL(pathname, ORIGIN));
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
}

/** The built worker, run against a fake `self`, `caches` and `fetch`. */
function boot() {
  const listeners = new Map<string, Listener>();
  const caches = fakeCaches();
  const fetch: Mock<(request: RequestInfo) => Promise<Response>> = vi.fn();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  const source = renderServiceWorker(ASSETS);
  // `new Function` rather than node:vm: a vm context has its own TypeError, and
  // the worker tells a network failure apart with `instanceof TypeError`.
  new Function("self", "caches", "fetch", source)(self, caches, fetch);
  const version = /const VERSION = "([^"]+)"/.exec(source)?.[1];
  if (!version) throw new Error("the built worker names no version");

  async function lifecycle(type: "install" | "activate") {
    const pending: Promise<unknown>[] = [];
    listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  }

  /** The response the worker answered with, or `undefined` when it left the request alone. */
  async function request(request: Request): Promise<Response | undefined> {
    const respondWith = vi.fn();
    listeners.get("fetch")?.({ request, respondWith });
    const answer = respondWith.mock.calls[0]?.[0] as Promise<Response> | undefined;
    return answer;
  }

  async function cached(url: string) {
    return (await caches.open(`kasten-${version}`)).match(url);
  }

  return { self, caches, fetch, version, lifecycle, request, cached };
}

/** A worker that has installed with a shell reading `old shell`. */
async function installed() {
  const sw = boot();
  sw.fetch.mockImplementation(async (request) => {
    const url = typeof request === "string" ? request : request.url;
    return basic(url.endsWith("/") ? "old shell" : `asset ${url}`);
  });
  await sw.lifecycle("install");
  sw.fetch.mockReset();
  return sw;
}

describe("the service worker", () => {
  it("install precaches the shell and every listed asset", async () => {
    const sw = boot();
    sw.fetch.mockImplementation(async () => basic("x"));
    await sw.lifecycle("install");
    expect(sw.fetch.mock.calls.map(([request]) => request).sort()).toEqual(["/", ...ASSETS].sort());
    for (const url of ["/", ...ASSETS]) expect(await sw.cached(url)).toBeDefined();
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it("install stores no sign-in page as the shell", async () => {
    const sw = boot();
    sw.fetch.mockImplementation(async (request) => {
      if (request !== "/") return basic("x");
      const signIn = basic("sign in");
      Object.defineProperty(signIn, "redirected", { value: true });
      return signIn;
    });
    await expect(sw.lifecycle("install")).rejects.toThrow();
    expect(await sw.cached("/")).toBeUndefined();
  });

  it("offline, a navigation to /capture?text=x answers the cached shell", async () => {
    const sw = await installed();
    sw.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const answer = await sw.request(navigation("/capture?text=x"));
    expect(await answer?.text()).toBe("old shell");
  });

  it("offline with an expired session, a navigation still answers the cached shell", async () => {
    // Offline, oauth2-proxy is as unreachable as nginx, so there is no
    // redirect to see: the fetch throws and the shell answers.
    const sw = await installed();
    sw.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const answer = await sw.request(navigation("/"));
    expect(await answer?.text()).toBe("old shell");
  });

  it("offline with nothing cached, a navigation answers a network error", async () => {
    const sw = boot();
    sw.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const answer = await sw.request(navigation("/"));
    expect(answer?.type).toBe("error");
  });

  it("online, a navigation answers the network and refreshes the cached shell", async () => {
    const sw = await installed();
    sw.fetch.mockResolvedValue(basic("new shell"));
    const answer = await sw.request(navigation("/capture"));
    expect(await answer?.text()).toBe("new shell");
    expect(await (await sw.cached("/"))?.text()).toBe("new shell");
  });

  it("a navigation redirected to the sign-in page goes through and is not cached", async () => {
    const sw = await installed();
    const redirect = opaqueRedirect();
    sw.fetch.mockResolvedValue(redirect);
    expect(await sw.request(navigation("/"))).toBe(redirect);
    expect(await (await sw.cached("/"))?.text()).toBe("old shell");
  });

  it("a navigation to a file that is not html is not cached as the shell", async () => {
    // Opening /favicon.svg or /sw.js as a page would otherwise make it the app.
    const sw = await installed();
    sw.fetch.mockResolvedValue(basic("<svg/>", 200, "image/svg+xml"));
    const answer = await sw.request(navigation("/favicon.svg"));
    expect(await answer?.text()).toBe("<svg/>");
    expect(await (await sw.cached("/"))?.text()).toBe("old shell");
  });

  it("a navigation answered 401 goes through and is not cached", async () => {
    const sw = await installed();
    sw.fetch.mockResolvedValue(basic("unauthorized", 401));
    const answer = await sw.request(navigation("/"));
    expect(answer?.status).toBe(401);
    expect(await (await sw.cached("/"))?.text()).toBe("old shell");
  });

  it("serves a cached hashed asset without fetching, and caches one it misses", async () => {
    const sw = await installed();
    const hit = await sw.request(new Request(`${ORIGIN}/assets/index-abc.js`));
    expect(await hit?.text()).toBe(`asset /assets/index-abc.js`);
    expect(sw.fetch).not.toHaveBeenCalled();

    sw.fetch.mockResolvedValue(basic("lazy chunk"));
    const miss = await sw.request(new Request(`${ORIGIN}/assets/route-xyz.js`));
    expect(await miss?.text()).toBe("lazy chunk");
    expect(await (await sw.cached("/assets/route-xyz.js"))?.text()).toBe("lazy chunk");
  });

  it("serves an unhashed public file from the network, and from the cache offline", async () => {
    const sw = await installed();
    sw.fetch.mockResolvedValue(basic("fit v2"));
    const online = await sw.request(new Request(`${ORIGIN}/viewport-fit.js`));
    expect(await online?.text()).toBe("fit v2");

    sw.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const offline = await sw.request(new Request(`${ORIGIN}/viewport-fit.js`));
    expect(await offline?.text()).toBe("fit v2");
  });

  it("leaves the api, the sign-in, the chat, the terminal and the agent paths alone", async () => {
    const sw = await installed();
    for (const pathname of [
      "/api/dump",
      "/oauth2/start",
      "/chat/x",
      "/term/x",
      "/agent/x",
      "/.well-known/x",
    ]) {
      expect(await sw.request(navigation(pathname))).toBeUndefined();
      expect(await sw.request(new Request(`${ORIGIN}${pathname}`))).toBeUndefined();
    }
    expect(await sw.request(new Request(`${ORIGIN}/`, { method: "POST" }))).toBeUndefined();
    expect(await sw.request(new Request("https://elsewhere.test/x.js"))).toBeUndefined();
  });

  it("activate deletes the caches of an older version", async () => {
    const sw = await installed();
    await sw.caches.open("kasten-0ld");
    await sw.lifecycle("activate");
    expect(await sw.caches.keys()).toEqual([`kasten-${sw.version}`]);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });
});

describe("the service worker plugin", () => {
  it("emits sw.js listing the shell and every assets/ file", () => {
    const plugin = serviceWorker();
    const emitFile = vi.fn();
    const bundle = {
      "assets/index-abc.js": {},
      "assets/index-def.css": {},
      "index.html": {},
    };
    // biome-ignore lint/complexity/noBannedTypes: rollup's hook, called the way rollup calls it
    (plugin.generateBundle as Function).call({ emitFile }, {}, bundle);
    expect(emitFile).toHaveBeenCalledTimes(1);
    expect(emitFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: "asset", fileName: "sw.js" }),
    );
    const source: string = emitFile.mock.lastCall?.[0]?.source ?? "";
    const list = JSON.parse(/const PRECACHE = (\[.*\]);/.exec(source)?.[1] ?? "null");
    expect(list.sort()).toEqual(["/", ...ASSETS].sort());
  });

  it("lists the public files a first offline start needs, and not pdf.js", () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), "kasten-public-"));
    for (const name of [
      "viewport-fit.js",
      "manifest.webmanifest",
      "favicon.svg",
      "icons/app-192.png",
      "pdfjs/pdf.worker.mjs",
      "pdfjs/.stamp",
    ]) {
      mkdirSync(path.dirname(path.join(publicDir, name)), { recursive: true });
      writeFileSync(path.join(publicDir, name), "");
    }
    const plugin = serviceWorker();
    const emitFile = vi.fn();
    // biome-ignore lint/complexity/noBannedTypes: rollup's hooks, called the way vite calls them
    (plugin.configResolved as Function)({ publicDir });
    // biome-ignore lint/complexity/noBannedTypes: as above
    (plugin.generateBundle as Function).call({ emitFile }, {}, { "assets/index-abc.js": {} });
    const source: string = emitFile.mock.lastCall?.[0]?.source ?? "";
    const list = JSON.parse(/const PRECACHE = (\[.*\]);/.exec(source)?.[1] ?? "null");
    expect(list.sort()).toEqual(
      [
        "/",
        "/assets/index-abc.js",
        "/favicon.svg",
        "/icons/app-192.png",
        "/manifest.webmanifest",
        "/viewport-fit.js",
      ].sort(),
    );
  });

  it("changes the version when the asset list changes", () => {
    const one = /const VERSION = "([^"]+)"/.exec(renderServiceWorker(ASSETS))?.[1];
    const two = /const VERSION = "([^"]+)"/.exec(renderServiceWorker(["/assets/other.js"]))?.[1];
    expect(one).toBeTruthy();
    expect(one).not.toBe(two);
  });
});

describe("registering the service worker", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("registers nothing outside a production build", () => {
    const register = vi.fn(async () => ({}));
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });
    registerServiceWorker();
    window.dispatchEvent(new Event("load"));
    expect(register).not.toHaveBeenCalled();
  });
});
