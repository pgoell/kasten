import { EditorView } from "@codemirror/view";
import { docIn } from "@/lib/pane-doc";

it("#983 a pane's editor lookup skips the editor on its way out", () => {
  const pane = document.body.appendChild(document.createElement("div"));
  pane.dataset.pane = "p1";
  // The old note's editor comes first in the pane, as it does while it is on its way out.
  const leaving = pane.appendChild(document.createElement("div"));
  leaving.dataset.leaving = "";
  const old = new EditorView({ doc: "old note", parent: leaving });
  const current = pane.appendChild(document.createElement("div"));
  const shown = new EditorView({ doc: "new note", parent: current });

  expect(docIn("p1")).toBe("new note");

  old.destroy();
  shown.destroy();
  pane.remove();
});
