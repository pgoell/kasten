import { act, render } from "@testing-library/react";
import { ListsApp } from "@/lists/lists-app";
import { fakeShare } from "./lists-fixture";

/** Answer `matchMedia` for the scheme with `dark`, and let a test flip it as a phone does. */
function stubScheme(dark: boolean) {
  let matches = dark;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    change(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

describe("the lists app's theme", () => {
  it("#810 A1 the app is dark when the phone is dark and follows a change while open", async () => {
    const scheme = stubScheme(true);
    vi.stubGlobal("fetch", fakeShare({ Einkauf: [], Todo: [] }).fetch);
    render(<ListsApp />);

    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => scheme.change(false));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
