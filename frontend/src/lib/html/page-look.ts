import { currentPalette, currentTheme } from "@/lib/theme";

/**
 * Tells the page the theme and the palette on screen, so a switch reaches it
 * with no reload. The target is `*` because the frame's origin is opaque (it has
 * no `allow-same-origin`), so no origin would match.
 */
export function postLook(frame: HTMLIFrameElement | null) {
  const page = frame?.contentWindow;
  page?.postMessage({ kasten: "theme", theme: currentTheme() }, "*");
  page?.postMessage({ kasten: "palette", palette: currentPalette() }, "*");
}
