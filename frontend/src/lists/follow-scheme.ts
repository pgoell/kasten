const DARK = "(prefers-color-scheme: dark)";

/**
 * Set `data-theme` and the browser bar colour from the phone's scheme, now and on each change.
 * Returns the stop function. Reads the phone's scheme, not the app's stored choice, which lives
 * under another address.
 */
export function followScheme(): () => void {
  const dark = matchMedia(DARK);
  const paint = () => {
    const root = document.documentElement;
    root.dataset.theme = dark.matches ? "dark" : "light";
    const page = getComputedStyle(root).getPropertyValue("--k-bg").trim();
    if (!page) return;
    for (const bar of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      bar.content = page;
    }
  };
  paint();
  dark.addEventListener("change", paint);
  return () => dark.removeEventListener("change", paint);
}
