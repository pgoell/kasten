/**
 * That the policy reaches the document and that a book cannot run a script.
 *
 * Real Chromium, because jsdom enforces no Content Security Policy at all and
 * would pass every assertion here with no policy served.
 *
 * The book documents are hand-built rather than read out of an epub: nothing
 * has opened a book yet at this point in the branch, and the mechanism under
 * test is the blob URL, which is what foliate hands the iframe.
 */

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
