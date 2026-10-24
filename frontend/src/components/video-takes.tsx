import { CLOCK, clockOf } from "@/components/video-transcript";
import { videoTakes } from "@/lib/video-notes";

/** The takes of this video in the note, each with its time as a button that seeks. */
export function VideoTakes({
  text,
  id,
  onSeek,
}: {
  /** The note's text, which holds the takes. */
  text: string;
  /** The video's id: a take of another video in the note is left out. */
  id: string;
  onSeek: (seconds: number) => void;
}) {
  const takes = videoTakes(text, id);
  if (takes.length === 0) {
    return (
      <p className="px-3 font-sans text-k-13 text-k-muted">Nothing taken from this video yet.</p>
    );
  }

  return (
    <ul aria-label="Taken from this video" className="px-3">
      {takes.map((take) => (
        <li key={take.id} className="flex items-start">
          <button
            type="button"
            aria-label={`Seek to ${clockOf(take.seconds)}`}
            onClick={() => onSeek(take.seconds)}
            className={CLOCK}
          >
            {clockOf(take.seconds)}
          </button>
          <p className="min-w-0 flex-1 font-serif text-k-15 text-k-ink line-clamp-2">
            {take.quote}
          </p>
        </li>
      ))}
    </ul>
  );
}
