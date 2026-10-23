/**
 * The pdf take's stub, on top of the html take's (`./html-take-api`): every
 * `/api/assets/` path answers with the fixture pdf from `./pdf-fixture`, with
 * byte ranges, which pdf.js asks for. Anything else goes to the html take's stub,
 * which answers the dumps and the daily note, or on to the real fetch.
 *
 * Each pdf take test file imports this first, so the stub is installed before
 * the pane fetches its pdf.
 */

import "./html-take-api";
import { textAndImagePdf } from "./pdf-fixture";

const previous = globalThis.fetch;

let fixture: Promise<Uint8Array<ArrayBuffer>> | null = null;

/** The fixture's bytes, made once. */
function bytesOfFixture(): Promise<Uint8Array<ArrayBuffer>> {
  fixture ??= textAndImagePdf()
    .arrayBuffer()
    .then((buffer) => new Uint8Array(buffer));
  return fixture;
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : undefined;
  const url = new URL(request?.url ?? String(input), window.location.href);
  if (!url.pathname.startsWith("/api/assets/")) return previous(input, init);

  const bytes = await bytesOfFixture();
  const headers = new Headers(request?.headers ?? init?.headers);
  const common = { "Accept-Ranges": "bytes", "Content-Type": "application/pdf" };
  const range = /^bytes=(\d+)-(\d*)$/.exec(headers.get("Range") ?? "");
  if (range === null) return new Response(bytes, { headers: common });

  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: { ...common, "Content-Range": `bytes ${start}-${end}/${bytes.length}` },
  });
};
