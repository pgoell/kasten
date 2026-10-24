import { timestamp } from "@/lib/transcript";
import { currentAt, type Timed } from "@/lib/video-notes";

interface VideoDetailsProps {
  /** The player's title, or the note's name until the player has said one. */
  title: string;
  /** The note's `speaker`, else the player's author. No line when neither is set. */
  speaker?: string;
  /** The note's `## Chapters`, in the order they are written. */
  chapters: Timed[];
  /** The second the player is at, which marks the chapter it is in. */
  at: number;
  onSeek: (seconds: number) => void;
}

/**
 * The title and speaker of the video, and its chapters as a list to seek by.
 *
 * The chapter list is a list and not a row of buttons so a screen reader reads
 * its length and where the current one falls.
 */
export function VideoDetails({ title, speaker, chapters, at, onSeek }: VideoDetailsProps) {
  const now = currentAt(chapters, at);
  return (
    <>
      <div className="px-3">
        <h2 className="font-serif text-k-19 leading-(--k-leading-title) text-k-ink">{title}</h2>
        {speaker !== undefined && <p className="font-sans text-k-13 text-k-muted">{speaker}</p>}
      </div>
      {chapters.length > 0 && (
        <ol aria-label="Chapters" className="flex flex-col">
          {chapters.map((chapter, n) => {
            const current = n === now;
            return (
              <li key={`${chapter.seconds}:${chapter.text}`}>
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => onSeek(chapter.seconds)}
                  className={`k-row flex w-full gap-3 border-l-2 px-3 py-1 text-left font-sans text-k-13 pointer-coarse:min-h-11 ${
                    current ? "border-k-accent text-k-accent" : "border-transparent text-k-ink"
                  }`}
                >
                  <span className="font-mono text-k-muted tabular-nums">
                    {timestamp(chapter.seconds).slice(1, -1)}
                  </span>
                  <span>{chapter.text}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
