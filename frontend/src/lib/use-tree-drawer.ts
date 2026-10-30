import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeCommands } from "@/lib/key-bindings";
import type { Layout } from "@/lib/panes";
import { type loadWorkspace, saveWorkspace } from "@/lib/workspace";

export type TreeDrawer = ReturnType<typeof useTreeDrawer>;

/** The file tree's open state, its focus and reveal counters, and the commands that drive them. */
export function useTreeDrawer({
  narrow,
  saved,
  savedAs,
  layout,
  focusSignal,
}: {
  narrow: boolean;
  saved: ReturnType<typeof loadWorkspace>;
  savedAs: boolean;
  layout: Layout;
  focusSignal: number;
}) {
  // Lives here, not in the panel: the toggle key is pressed inside the editor.
  // Shut below `md`, where it is a drawer over the page; wider, it starts as last left.
  const [treeOpen, setTreeOpen] = useState(!narrow && (saved?.treeOpen ?? true));
  // Saves the whole workspace on each change. The last tab to move wins; tabs do not listen.
  // Keeps the tree as a wide window left it: a narrow window shuts it whatever was saved.
  const wideTree = useRef(saved?.treeOpen ?? true);
  useEffect(() => {
    if (!narrow) wideTree.current = treeOpen;
    saveWorkspace(savedAs, layout, wideTree.current);
  }, [savedAs, layout, treeOpen, narrow]);
  // Shuts when focus moves to a pane (it covers the page), or when the window narrows under it.
  // Set in render, not an effect: the page under the drawer is inert while it is open.
  const [shutFor, setShutFor] = useState({ narrow, focusSignal });
  if (shutFor.narrow !== narrow || shutFor.focusSignal !== focusSignal) {
    setShutFor({ narrow, focusSignal });
    if (narrow) setTreeOpen(false);
  }
  // A counter, not a flag: asking twice in a row must read as two changes.
  const [treeFocus, setTreeFocus] = useState(0);
  // Asks the tree to unfold to the open note. Separate from the focus, which does not jump.
  const [treeReveal, setTreeReveal] = useState(0);
  const commands = useMemo<Pick<TreeCommands, "toggleTree" | "focusTree" | "revealTree">>(
    () => ({
      toggleTree: () => setTreeOpen((previous) => !previous),
      // Both, and in one render: a folded panel has no row to focus.
      focusTree: () => {
        setTreeOpen(true);
        setTreeFocus((previous) => previous + 1);
      },
      // One render, so the tree has the focus by the time the panel moves onto the revealed row.
      revealTree: () => {
        setTreeOpen(true);
        setTreeReveal((previous) => previous + 1);
        setTreeFocus((previous) => previous + 1);
      },
    }),
    [],
  );

  return { treeOpen, setTreeOpen, treeFocus, treeReveal, commands };
}
