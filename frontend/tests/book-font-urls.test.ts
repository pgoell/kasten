import { absoluteUrls } from "@/lib/book-fonts";

describe("absoluteUrls", () => {
  it("makes each relative url absolute and keeps a data url as it is", () => {
    const css = `src: url("./files/a.woff2") format("woff2"), url(data:font/woff2;base64,AA==);`;

    expect(absoluteUrls(css, "http://localhost/fonts/")).toBe(
      `src: url("http://localhost/fonts/files/a.woff2") format("woff2"), url("data:font/woff2;base64,AA==");`,
    );
  });
});
