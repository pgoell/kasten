/** Display only, drawn by the help panel. The panes and `rsvp.tsx` resolve the keys. */

export const READER: readonly { key: string; label: string }[] = [
  { key: "l", label: "Turn to the next page" },
  { key: "h", label: "Turn back to the page before" },
  { key: "t", label: "Show the contents" },
  { key: "y", label: "Take the selection" },
  { key: "w", label: "Download what this pane holds as a file" },
  { key: "q", label: "Close the book" },
  { key: "Space", label: "Show the leader keys" },
];

/** Opened by `Space r r` or `Space r h`. */
export const RSVP_KEYS: readonly { key: string; label: string }[] = [
  { key: "Space", label: "Play or pause" },
  { key: "h / l", label: "Back or forward a sentence" },
  { key: "H / L", label: "Back or forward a paragraph" },
  { key: "j / k", label: "Slower or faster" },
  { key: "r", label: "In a book: write this place as reading:" },
  { key: "R", label: "In a book: go to the place reading: holds" },
  { key: "Escape", label: "Close the reader" },
];
