/**
 * The policy that stops a book running code as kasten.
 *
 * An epub carries HTML, and foliate renders each section from a same-origin
 * `blob:` URL because selection and navigation need same origin. A document
 * loaded from a blob URL inherits the policy of the page that made the URL, so
 * this governs the book's own markup. It is the whole defence: foliate creates
 * its iframes itself, hard-codes `allow-scripts` on them and hides them behind
 * closed shadow roots, so nothing outside can sandbox them.
 *
 * One policy, two consumers, and `nginx.conf` cannot import from TypeScript. So
 * the directives live here, the dev server's plugin builds its header from them,
 * and `tests/csp.test.ts` reads nginx.conf and compares. That is the cheapest
 * thing that fails when somebody edits one copy and not the other.
 */

const DIRECTIVES = [
  "default-src 'self'",
  // A chapter can carry a script three ways and this refuses all three: inline
  // has no nonce, a `src` inside the archive is rewritten to a blob URL, and a
  // `src` naming somewhere else is left as written. Never add `blob:` here.
  "script-src 'self'",
  // CodeMirror and xterm both inject `<style>` elements at runtime through
  // style-mod, and a book's own stylesheet arrives as a blob URL.
  "style-src 'self' 'unsafe-inline' blob:",
  // A book's images and fonts arrive as blob URLs, and the editor and the book
  // both use inline SVG data URLs.
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "media-src 'self' blob:",
  // The API, the event stream and the ttyd WebSocket are all same origin, and
  // CSP level 3 reads `'self'` as covering `ws:` and `wss:` on it.
  "connect-src 'self'",
  // Two frames, and neither is covered by `default-src 'self'`: the reader's
  // blob URL, and the YouTube player a note's video is watched in. The one host
  // is named rather than the whole of `https:`, so this is permission for the
  // player and for nothing else that a note might come to link.
  "frame-src blob: https://www.youtube.com",
  // Not the `'none'` hardening guides ask for: foliate rewrites every
  // `object[data]` in a section to a blob URL, so books really do use the
  // element, and `'none'` would blank part of a valid book in silence. An
  // `<object>` loading HTML inherits this policy too, so its scripts stay
  // blocked.
  "object-src blob:",
  "base-uri 'none'",
  // `default-src` does not govern where a form posts, and kasten has none to
  // submit.
  "form-action 'none'",
];

/** The policy production serves. */
export const POLICY = DIRECTIVES.join("; ");

/**
 * The same policy with the one directive development has to change.
 *
 * Vite's dev server injects the react-refresh preamble as an inline module
 * script, so `script-src 'self'` alone takes the dev app down. The nonce is
 * minted per dev server start and is never a literal: a fixed string would be
 * readable by anybody who has seen this repo, and a book can carry a
 * `nonce="…"` of its own.
 */
export function devPolicy(nonce: string): string {
  return POLICY.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`);
}
