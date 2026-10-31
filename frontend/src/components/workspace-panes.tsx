import { useQueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { PaneBody, type PaneExtras } from "@/components/pane-body";
import { PaneLayout } from "@/components/pane-layout";
import { isUnsaved, TabStrip } from "@/components/tab-strip";
import type { PaneMoves } from "@/components/use-pane-moves";
import type { TreeCommands } from "@/lib/key-bindings";
import type { SaveStatus } from "@/lib/note/use-autosave";
import { makeNote } from "@/lib/note/use-note-opening";
import { openBeside } from "@/lib/pane-contents";
import {
  activeTab,
  closeTab,
  focusPane,
  goToTab,
  homeTab,
  type Layout,
  tabPanes,
} from "@/lib/panes";
import { useRsvpAsked } from "@/lib/rsvp/use-rsvp";
import { useVideoAsks } from "@/lib/video/use-video-player";

/**
 * The panes of the active tab: the tab strip over the split panes, and the
 * one pane each of them holds, drawn by what the pane holds.
 */
export function WorkspacePanes({
  layout,
  narrow,
  keyboard,
  inert,
  moveTo,
  setLayout,
  commands,
  focusSignal,
  playSignal,
  graphAsk,
  graphSheet,
  preview,
  listings,
  opening,
  writes,
  todos,
  logActions,
  onTodoPrompt,
  todoRow,
  onDeleteImage,
  buffer,
  autosave,
  status,
  onNotice,
}: {
  layout: Layout;
  narrow: boolean;
  /** Whether an on-screen keyboard is up, which shows a narrow split's focused pane alone. */
  keyboard: boolean;
  inert: boolean;
  moveTo: PaneMoves["moveTo"];
  setLayout: Dispatch<SetStateAction<Layout>>;
  commands: TreeCommands;
  focusSignal: number;
  playSignal: number;
  graphAsk: PaneExtras["graphAsk"];
  graphSheet?: PaneExtras["graphSheet"];
  preview: boolean;
  listings: PaneExtras["listings"];
  opening: PaneExtras["opening"];
  writes: PaneExtras["writes"];
  todos: PaneExtras["todos"];
  logActions: PaneExtras["logActions"];
  onTodoPrompt: PaneExtras["onTodoPrompt"];
  todoRow: PaneExtras["todoRow"];
  onDeleteImage: PaneExtras["onDeleteImage"];
  buffer: PaneExtras["buffer"];
  autosave: PaneExtras["autosave"];
  status: SaveStatus;
  onNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const tab = activeTab(layout);
  const rsvpAsk = useRsvpAsked();
  const { data, archive } = listings;
  const queryClient = useQueryClient();
  const video = useVideoAsks(layout, playSignal, onNotice);

  /**
   * Open a note beside its pdf, making the note first if the vault has none. A refused path shows
   * in the bar and leaves the pdf alone.
   */
  async function noteBeside(path: string) {
    let note = path;
    if (!data?.includes(path)) {
      // The list can be behind the vault: a note made since it was read answers
      // 409, and that note is the one wanted, not a refusal.
      const made = await makeNote(queryClient, path, "", true);
      if (made === undefined) {
        onNotice(`The vault refused ${path}`);
        return;
      }
      note = made;
    }
    moveTo((previous) => openBeside(previous, (pane) => pane.path === note, { path: note }, "row"));
  }
  return (
    /* min-w-0 lets the panes shrink instead of pushing the tree off-screen.
        The strip sits inside this column rather than over the whole window,
        so the tabs line up with the panes they divide. */
    <div
      // Out of reach under an open drawer, so Tab stays in the drawer and
      // nothing is typed into a note behind the backdrop.
      inert={inert}
      className="flex min-w-0 flex-1 flex-col"
    >
      {/* Every change here goes through `moveTo`, the same guard a move takes:
          closing the note's tab flushes its text first, and is refused while
          the note stands conflicted. */}
      <TabStrip
        layout={layout}
        narrow={narrow}
        onSelect={(index) => moveTo((previous) => goToTab(previous, index))}
        onClose={(index) => moveTo((previous) => closeTab(previous, index))}
        onHome={() => moveTo((previous) => homeTab(previous))}
        unsaved={(each) => isUnsaved(each, each.id === tab.id, buffer.held, status)}
      />
      <div className="flex min-h-0 flex-1">
        <PaneLayout
          node={tab.root}
          focus={tab.focus}
          tabId={tab.id}
          narrow={narrow}
          divided={tabPanes(layout).length > 1}
          // Below `md` a split is stacked (`PaneLayout`), except while the
          // keyboard is up: two panes would leave ~100px to type in. The tree
          // and `tab.zoom` are kept, so the stack returns with the window or
          // the keyboard.
          zoomed={tab.zoom === true || (narrow && keyboard) ? tab.focus : null}
          // The one way to another pane that `moveTo` does not stand in
          // front of, and it stays that way on purpose. This is reported
          // after the browser has moved the focus, so declining it would
          // leave the cursor blinking in a pane the border says is not the
          // focused one, and pulling the focus back is a fight with the
          // browser over a note that is already only one `:w` from being
          // settled. So a click into another pane while the open note
          // stands conflicted still leaves it, and the flush still writes.
          // A test pins that, so closing it later is a decision rather than
          // an accident.
          onFocus={(id) => setLayout((previous) => focusPane(previous, id))}
        >
          {(shown, focused) => (
            <PaneBody
              shown={shown}
              focused={focused}
              shared={{ commands, focusSignal, archive, openInPane: opening.openInPane, onNotice }}
              extras={{
                paths: data,
                setLayout,
                moveTo,
                preview,
                listings,
                opening,
                writes,
                todos,
                logActions,
                onTodoPrompt,
                todoRow,
                onDeleteImage,
                buffer,
                autosave,
                graphAsk,
                graphSheet,
                rsvpAsk,
                video,
                noteBeside,
              }}
            />
          )}
        </PaneLayout>
      </div>
    </div>
  );
}
