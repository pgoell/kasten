/** What the video pane answers, beside a note that links a video. Display only. */
export const VIDEO_PANE: readonly { key: string; label: string }[] = [
  { key: "n", label: "Play the note's next video" },
  { key: "p", label: "Play the note's previous video" },
  { key: "k", label: "Play or pause" },
  { key: "j", label: "Ten seconds back" },
  { key: "l", label: "Ten seconds on" },
  { key: "f", label: "Full screen, and out again" },
  { key: "ArrowUp", label: "Volume up" },
  { key: "ArrowDown", label: "Volume down" },
  { key: "m", label: "Mute, and back at the same volume" },
  { key: "y", label: "Take the selected transcript into the note" },
];
