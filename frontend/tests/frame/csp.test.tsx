/**
 * That the policy reaches the document and that a book cannot run a script.
 *
 * Real Chromium, because jsdom enforces no Content Security Policy at all and
 * would pass every assertion here with no policy served.
 *
 * The first four cases build their book documents by hand, because the
 * mechanism under test is the blob URL, which is what foliate hands the iframe.
 * The last one reads a real epub through the real reader.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { BookPane } from "@/components/book-pane";
import scriptedUrl from "../fixtures/scripted.epub?url";
import { stubCommands } from "../stub-commands";
import "@/styles/app.css";

const { fetchBook, fetchNote } = vi.hoisted(() => ({ fetchBook: vi.fn(), fetchNote: vi.fn() }));
// The Perf job runs no backend, so the pane must not fetch. See
// `tests/frame/book-pane.test.tsx` for why seeding the query is a trap.
// The two extra names are the ones `book-pane.test.tsx` explains.
vi.mock("@/lib/api", () => ({
  fetchBook,
  fetchNote,
  fetchImages: () => Promise.resolve([]),
  uploadAsset: () => Promise.resolve(),
}));

/** Every section document foliate reported, which is the only way inside. */
const sections: Document[] = [];
document.addEventListener(
  "load",
  (event) => {
    const { doc } = (event as CustomEvent<{ doc?: Document }>).detail ?? {};
    if (doc) sections.push(doc);
  },
  true,
);

/** Every blob URL this file made, revoked after each test. */
const made: string[] = [];

function blobUrl(body: string, type: string): string {
  const url = URL.createObjectURL(new Blob([body], { type }));
  made.push(url);
  return url;
}

/** Load one document in an iframe sandboxed exactly the way foliate sandboxes one. */
async function loadBook(html: string): Promise<Document> {
  const frame = document.createElement("iframe");
  // `paginator.js:244` and `fixed-layout.js:86` both hard-code this pair, and
  // both roots are closed, so kasten cannot take `allow-scripts` away.
  frame.sandbox.add("allow-same-origin", "allow-scripts");
  frame.src = blobUrl(html, "text/html");
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  await loaded;

  const doc = frame.contentDocument;
  if (!doc) throw new Error("the frame never loaded, so frame-src is refusing blob:");
  return doc;
}

function chapter(head: string): string {
  return `<!doctype html><html><head><title>SAFE</title>${head}</head><body><p>A chapter.</p></body></html>`;
}

afterEach(() => {
  for (const url of made.splice(0)) URL.revokeObjectURL(url);
  for (const frame of document.querySelectorAll("iframe")) frame.remove();
});

describe("a book's own scripts", () => {
  it("is served a policy on the document the tests run in", async () => {
    // Said out loud, because every assertion below passes with no policy at all
    // if the header never reaches this page.
    const response = await fetch(location.href);

    expect(response.headers.get("content-security-policy")).toContain("script-src");
  });

  it("cannot run one written inline", async () => {
    const doc = await loadBook(chapter('<script>document.title = "SCRIPT RAN";</script>'));

    // The book's own title, never the page's: a script in the frame cannot
    // reach the outer one anyway, so that assertion would pass either way.
    expect(doc.title).toBe("SAFE");
  });

  it("cannot run one carrying a guessed nonce", async () => {
    const doc = await loadBook(
      chapter('<script nonce="kasten-dev">document.title = "SCRIPT RAN";</script>'),
    );

    expect(doc.title).toBe("SAFE");
  });

  it("cannot run one loaded from another blob url", async () => {
    // The case that catches `blob:` creeping into script-src later, which an
    // inline-only test stays green through.
    const script = blobUrl('document.title = "SCRIPT RAN";', "text/javascript");
    const doc = await loadBook(chapter(`<script src="${script}"></script>`));

    expect(doc.title).toBe("SAFE");
  });
});

describe("a script inside a real book", () => {
  it("does not run when foliate opens the file", async () => {
    // Slice 3 proved the mechanism with hand-built documents because no reader
    // existed yet. This proves it through foliate's own blob rewriting, on the
    // same file the box check reads.
    fetchBook.mockResolvedValue(await (await fetch(scriptedUrl)).blob());
    // The pane reads its note before it navigates, and a factory missing an
    // export throws the moment it is called. This file mounts the pane only to
    // prove the policy, which is what makes it the one nobody thinks of.
    fetchNote.mockResolvedValue("");
    const pageTitle = document.title;
    const container = document.createElement("div");
    container.style.cssText = "width: 600px; height: 400px;";
    document.body.append(container);
    const root = createRoot(container);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    });

    root.render(
      <QueryClientProvider client={client}>
        <BookPane
          note="20 Literature/Scripted.md"
          paths={["20 Literature/Scripted.md"]}
          commands={stubCommands()}
          focusSignal={0}
          onFocus={() => {}}
          onMoved={() => {}}
          onLeaving={() => {}}
        />
      </QueryClientProvider>,
    );

    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    const doc = sections[0] as Document;

    // The book's own title, which the script sets first, and the page's, which
    // it also reaches for.
    expect(doc.title).toBe("SAFE");
    expect(document.title).toBe(pageTitle);

    await new Promise((resolve) => requestAnimationFrame(resolve));
    root.unmount();
    container.remove();
  }, 30_000);
});
