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
 * The commands that fill the focused pane with a whole-pane kind. Each saves the note first.
 * Kept apart from `use-pane-commands.ts` for its size; its command table spreads these in.
 */
export function wholePaneOpeners(saveFirst: () => Promise<boolean>, moveTo: PaneMoves["moveTo"]) {
  return {
    // Saved first: replacing the pane unmounts its editor, and unsaved text goes with it.
    openTodos: async () => {
      if (await saveFirst()) moveTo(openTodosInFocused);
    },
    openLog: async () => {
      if (await saveFirst()) moveTo(openLogInFocused);
    },
    openOverview: async () => {
      if (await saveFirst()) moveTo(openOverviewInFocused);
    },
    openFinance: async () => {
      if (await saveFirst()) moveTo(openFinanceInFocused);
    },
    // Saved first: unsaved text would be written to a pane the autosave no longer follows.
    openReview: async () => {
      if (await saveFirst()) moveTo(openReviewInFocused);
    },
    // Saved first, as `openTodos`. Closing the pane later ends nothing; the runner owns it.
    openChat: async () => {
      if (await saveFirst()) moveTo(openChatInFocused);
    },
  };
}
