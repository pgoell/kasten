import { fireEvent, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { content, liveHooks, renderEditor } from "./live-preview-fixture";

liveHooks();

describe("live preview", () => {
  it("colours a tag and leaves its hash on screen", () => {
    const { container } = renderEditor(<Editor initialDoc="read this #reading/borges today" />);

    expect(container.querySelector(".cm-tag")?.textContent).toBe("#reading/borges");
    expect(content(container)).toBe("read this #reading/borges today");
  });

  it("keeps the tag colour while the line shows its source", async () => {
    const { container } = renderEditor(<Editor initialDoc="a #tag here" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(container.querySelector(".cm-tag")?.textContent).toBe("#tag"));
  });

  it("reads no tag out of a hash that is not one", () => {
    // A heading's mark, a fragment inside a word, a shebang in a fenced block
    // and a bare number: four hashes a looser pattern would have coloured.
    const { container } = renderEditor(
      <Editor initialDoc={"# Notes\n\nissue#12 and #1\n\n```sh\n#!/bin/sh\n```"} />,
    );

    expect(container.querySelector(".cm-tag")).toBeNull();
  });

  it("leaves the fragment of a URL alone", () => {
    const { container } = renderEditor(
      <Editor initialDoc="see https://example.com/#anchor and [docs](https://example.com/#top)" />,
    );

    expect(container.querySelector(".cm-tag")).toBeNull();
  });
});
