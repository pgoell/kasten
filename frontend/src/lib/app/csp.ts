/**
 * The policy that stops a book running code as kasten. An epub's sections load from same-origin
 * `blob:` URLs, which inherit this policy, so it governs the book's markup. foliate creates its own
 * iframes with `allow-scripts`, behind closed shadow roots, so nothing outside can sandbox them.
 * `nginx.conf` cannot import TypeScript, so `tests/csp.test.ts` compares the two copies.
 */

const DIRECTIVES = [
  "default-src 'self'",
  // Never add `blob:` here: book scripts are blob URLs, and this must refuse them.
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' blob:",
  // `https:` is for pictures a clipped article links, which cannot run code.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-src 'self' blob: https://www.youtube.com",
  // Not `'none'`: foliate rewrites each book `object[data]` to a blob URL.
  "object-src blob:",
  "base-uri 'none'",
  "form-action 'none'",
  // Only kasten frames the app, so no other site can clickjack it (#870).
  "frame-ancestors 'self'",
];

/** The policy production serves. */
export const POLICY = DIRECTIVES.join("; ");

/**
 * The same policy with the one directive development changes. Vite's react-refresh preamble is an
 * inline module script, so `script-src 'self'` alone breaks dev. The nonce is minted per dev start,
 * never a literal: a fixed one is readable by anyone, and a book can carry a `nonce` of its own.
 */
export function devPolicy(nonce: string): string {
  return POLICY.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`);
}
