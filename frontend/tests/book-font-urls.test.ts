import { absoluteUrls, fontFaces } from "@/lib/book/book-fonts";

describe("absoluteUrls", () => {
  it("makes each relative url absolute and keeps a data url as it is", () => {
    const css = `src: url("./files/a.woff2") format("woff2"), url(data:font/woff2;base64,AA==);`;

    expect(absoluteUrls(css, "http://localhost/fonts/")).toBe(
      `src: url("http://localhost/fonts/files/a.woff2") format("woff2"), url("data:font/woff2;base64,AA==");`,
    );
  });
});

/** A face rule as the browser hands it over: its text, and its family read off its style. */
function face(family: string, url: string) {
  return {
    cssText: `@font-face { font-family: "${family}"; src: url("${url}"); }`,
    style: { getPropertyValue: () => `"${family}"` },
  };
}

/** A stylesheet whose rules throw `thrown` when read, as another origin's do. */
function unreadable(thrown: Error) {
  return {
    href: "http://elsewhere/fonts.css",
    get cssRules(): never {
      throw thrown;
    },
  };
}

describe("fontFaces", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies the faces of the families asked for, skipping other rules and unreadable sheets", () => {
    const own = {
      href: "http://localhost/fonts/app.css",
      cssRules: [
        face("Serif X", "x.woff2"),
        face("Other", "o.woff2"),
        { cssText: "body { color: red; }" },
      ],
    };
    const elsewhere = unreadable(new DOMException("blocked", "SecurityError"));
    vi.spyOn(document, "styleSheets", "get").mockReturnValue([
      elsewhere,
      own,
    ] as unknown as StyleSheetList);

    expect(fontFaces(["'Serif X', serif"])).toBe(
      `@font-face { font-family: "Serif X"; src: url("http://localhost/fonts/x.woff2"); }`,
    );
  });

  it("lets any other failure to read a sheet through", () => {
    vi.spyOn(document, "styleSheets", "get").mockReturnValue([
      unreadable(new DOMException("broken", "InvalidAccessError")),
    ] as unknown as StyleSheetList);

    expect(() => fontFaces(["Serif X"])).toThrow("broken");
  });
});
