import { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@/components/editor";
import { Leaving } from "@/lib/ui/motion/leaving";

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// A long note in a sized box, held the way a pane holds one: hidden and marked
// leaving while the tab is away, and back on screen after.
function view(leaving: boolean, doc: string) {
  return (
    <div style={{ height: "300px", width: "600px" }}>
      <div style={leaving ? { display: "none" } : { height: "100%" }}>
        <Leaving.Provider value={leaving}>
          <Editor initialDoc={doc} path="scroll-983.md" />
        </Leaving.Provider>
      </div>
    </div>
  );
}

it("#983 an editor that comes back before it is taken down keeps its scroll", async () => {
  localStorage.clear();
  // The app's stylesheet gives the editor its height. Without it the scroller is
  // as tall as its text and nothing scrolls.
  const sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = ".h-full, .cm-editor { height: 100%; }";
  const doc = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(view(false, doc)));
    const scroller = host.querySelector<HTMLElement>(".cm-scroller");
    if (scroller === null) throw new Error("no editor was drawn");
    scroller.scrollTop = 600;
    await frame();
    expect(scroller.scrollTop).toBe(600);

    // Away for a frame, so the browser lays the hidden pane out, then back: the
    // position is written on the way out and the scroll must come back.
    await act(async () => root.render(view(true, doc)));
    await frame();
    await act(async () => root.render(view(false, doc)));
    await frame();
    await frame();

    expect(Math.abs(scroller.scrollTop - 600)).toBeLessThan(5);
  } finally {
    root.unmount();
    host.remove();
    sheet.remove();
  }
});

it("#2323 a scroll to the end of a long note draws no heading with its raw #", async () => {
  localStorage.clear();
  const sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = ".h-full, .cm-editor { height: 100%; }";
  // About 300 KB: past what CodeMirror's 20 ms first parse reaches, inside what the 200 ms cap parses.
  const part = `${"A paragraph the parser has to walk through, line by line.\n\n".repeat(10)}`;
  const doc = Array.from({ length: 500 }, (_, i) => `## Part ${i + 1}\n\n${part}`).join("");
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  // Every line with a raw heading mark at a paint. The editor draws a scroll in its own scroll handler, so a
  // microtask queued after it reads what the browser paints next.
  const raw: string[] = [];
  let painted = 0;
  const record = () => {
    painted += 1;
    for (const line of host.querySelectorAll(".cm-line")) {
      const text = line.textContent ?? "";
      if (/^#{1,6} /.test(text) && !raw.includes(text)) raw.push(text);
    }
  };
  const onScroll = () => queueMicrotask(record);
  try {
    await act(async () => root.render(view(false, doc)));
    const scroller = host.querySelector<HTMLElement>(".cm-scroller");
    if (scroller === null) throw new Error("no editor was drawn");
    scroller.addEventListener("scroll", onScroll);
    // A finger's fling or the scrollbar dragged to the end, at once.
    scroller.scrollTop = scroller.scrollHeight;
    const content = host.querySelector(".cm-content");
    for (let i = 0; i < 30 && !content?.textContent?.includes("Part 500"); i++) await frame();
    await frame();

    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(content?.textContent).toContain("Part 500");
    expect(painted).toBeGreaterThan(0);
    expect(raw).toEqual([]);
  } finally {
    root.unmount();
    host.remove();
    sheet.remove();
  }
});
