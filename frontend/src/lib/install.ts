/**
 * Which home screen app the page at a path belongs to.
 *
 * Two installable apps live on this origin: the whole notebook, and the
 * capture page with its share target. A browser installs whichever manifest
 * the document links, and `index.html` is one document for every route, so the
 * link is pointed here at the app the route is part of.
 *
 * The capture manifest keeps the address it has always had. Chrome finds an
 * installed app's updates by that address, and a phone that installed capture
 * before the notebook had a manifest must go on finding it.
 */

export interface Install {
  manifest: string;
  /** What iOS draws on the home screen, which reads no manifest icon. */
  icon: string;
  /** What iOS writes under that icon. */
  title: string;
}

const APP: Install = {
  manifest: "/app.webmanifest",
  icon: "/icons/app-maskable-512.png",
  title: "kasten",
};

const CAPTURE: Install = {
  manifest: "/manifest.webmanifest",
  icon: "/icons/capture-192.png",
  title: "dump",
};

export function installFor(pathname: string): Install {
  return pathname === "/capture" ? CAPTURE : APP;
}

/**
 * Point the document's install tags at the app `pathname` is part of.
 *
 * The tags are `index.html`'s own, so a document without them, which is every
 * test's, is left as it is.
 */
export function applyInstall(pathname: string, head: ParentNode = document.head): void {
  const { manifest, icon, title } = installFor(pathname);
  head.querySelector('link[rel="manifest"]')?.setAttribute("href", manifest);
  head.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", icon);
  head.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", title);
}
