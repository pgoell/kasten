import type { PaneMoves } from "@/components/use-pane-moves";
import {
  openChatInFocused,
  openFinanceInFocused,
  openLogInFocused,
  openOverviewInFocused,
  openReviewInFocused,
  openTodosInFocused,
} from "@/lib/pane-contents";

/**
 * The commands that fill the focused pane with one whole-pane kind: the todo list, the log,
 * the overview, the review and the chat. Each one saves the note first and then replaces what
 * the pane holds. Kept apart from `use-pane-commands.ts`, which is past the size a reader can
 * take in one go; its command table spreads these in, so a key reaches the same command.
 */
export function wholePaneOpeners(saveFirst: () => Promise<boolean>, moveTo: PaneMoves["moveTo"]) {
  return {
    // Saved first, unlike the panels: this replaces what the pane holds, which unmounts the
    // editor in it and would take unsaved text with it. The same rule `closeNote` follows.
    openTodos: async () => {
      if (await saveFirst()) moveTo(openTodosInFocused);
    },
    // Saved first for the reason `openTodos` is: the log replaces the pane.
    openLog: async () => {
      if (await saveFirst()) moveTo(openLogInFocused);
    },
    openOverview: async () => {
      if (await saveFirst()) moveTo(openOverviewInFocused);
    },
    openFinance: async () => {
      if (await saveFirst()) moveTo(openFinanceInFocused);
    },
    // Saved first for the reason `openExam` is: this replaces the focused pane, so text still
    // waiting would be written to a pane the autosave no longer follows. No note is named, unlike
    // the exam: the pane opens on the list of decks and picks its own.
    openReview: async () => {
      if (await saveFirst()) moveTo(openReviewInFocused);
    },
    // Saved first for the reason `openReview` is: this replaces the focused pane. Closing the
    // pane later ends nothing, the session being the runner's.
    openChat: async () => {
      if (await saveFirst()) moveTo(openChatInFocused);
    },
  };
}
