const DARK = "(prefers-color-scheme: dark)";

/**
 * Sets `data-theme` from the phone's colour scheme now, and again on each change, and
 * sets the browser bar to the page colour. Returns the function that stops following.
 *
 * The lists page reads the phone's scheme and not the main app's stored choice, which
 * lives under another address and is not this page's to read.
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
