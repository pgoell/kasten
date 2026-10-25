import { noteName } from "@/lib/note-path";
import { type Pane, panesOf, type Tab } from "@/lib/panes";

/** The pane a tab left focused: the one it is named and drawn by. */
export function focusedOf(tab: Tab): Pane | undefined {
  return panesOf(tab.root).find((pane) => pane.id === tab.focus);
}

/** What one tab is called: what is in the pane it left focused. */
export function tabLabel(tab: Tab): string {
  const focused = focusedOf(tab);
  // A terminal pane names its herdr session, which is the thing you named it.
  if (focused?.term !== undefined) return focused.term;
  if (focused?.todos === true) return "todos";
  if (focused?.log === true) return "log";
  if (focused?.overview === true) return "overview";
  if (focused?.finance === true) return "finance";
  if (focused?.chat === true) return "chat";
  // A reader names the note it reads beside, which is the only name it has.
  if (focused?.book !== undefined) return noteName(focused.book);
  // A player names the note it plays beside, which is the only name it has.
  if (focused?.video !== undefined) return noteName(focused.video);
  // A pdf, an image and a page are files and not notes, so they are named the
  // way Obsidian names a tab holding one: by the file, less its suffix (#361).
  if (focused?.pdf !== undefined) return baseName(focused.pdf.path);
  if (focused?.image !== undefined) return baseName(focused.image);
  if (focused?.html !== undefined) return baseName(focused.html);
  // An exam and a card are each about one note, and are named by it (#363).
  if (focused?.exam !== undefined) return noteName(focused.exam);
  if (focused?.person !== undefined) return noteName(focused.person);
  // Not the note's name alone, which the note's own tab already carries.
  if (focused?.history !== undefined) return `history of ${noteName(focused.history)}`;
  if (focused?.graph !== undefined) {
    const { around } = focused.graph;
    return around === undefined ? "graph view" : `graph of ${noteName(around)}`;
  }
  if (focused?.review === true) return "review";
  // Obsidian's name for a tab with nothing in it yet.
  return focused?.path === undefined ? "New tab" : noteName(focused.path);
}

/**
 * A file's name without its folder or its suffix: `x/my plan.pdf` is `my plan`.
 *
 * The last suffix only, where `noteName` takes off `.md` alone: these files
 * come in a dozen suffixes, and `report.v2.pdf` is `report.v2` and not `report`.
 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
}
