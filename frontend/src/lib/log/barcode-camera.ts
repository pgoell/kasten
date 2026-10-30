/** The camera a barcode scan holds. Every track stops on every path that ends a scan. */

import { type Decoder, decoderFor } from "@/lib/log/barcode";

export const NO_CAMERA = "No camera here; type the barcode instead";

/** How often a scan looks at the camera's frame: quick enough for a held barcode, light on the page. */
const SCAN_MS = 150;

/** How a scan ended on its own: a code was read, or the camera or the reader did not run. */
export type ScanEnd = { code: string } | { why: string };

const DID_NOT_START = "The camera did not start; type the barcode instead";

/** Why the camera would not open, in the panel's words. An error not listed still ends the scan, with its own words. */
function cameraWords(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "The camera is not allowed; type the barcode instead";
    }
    if (["NotFoundError", "OverconstrainedError", "NotReadableError"].includes(error.name)) {
      return NO_CAMERA;
    }
  }
  return DID_NOT_START;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** The torch button the panel holds. It starts hidden, so a scan never shows a button its track cannot use. */
export function torchButton(): HTMLButtonElement {
  const made = document.createElement("button");
  made.className = "cm-log-food-torch";
  made.type = "button";
  made.textContent = "Torch";
  made.setAttribute("aria-label", "Torch");
  made.setAttribute("aria-pressed", "false");
  made.hidden = true;
  return made;
}

/** The setting that turns the torch. The DOM types know no torch, so the name is added here. */
function torchConstraints(on: boolean): MediaTrackConstraints {
  const setting: MediaTrackConstraintSet & { torch: boolean } = { torch: on };
  return { advanced: [setting] };
}

/**
 * Reads the rear camera's frames until a barcode is held. The returned stop does not call `ended`.
 * `ended` gets the outcome, or none when the page hid or the panel left. `torch` shows only where the track has one.
 */
export function startCamera(
  video: HTMLVideoElement,
  root: Element,
  torch: HTMLButtonElement,
  ended: (outcome?: ScanEnd) => void,
): () => void {
  let live = true;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The track of the stream when it has a torch, or null, and whether the torch is on. */
  let track: MediaStreamTrack | null = null;
  let on = false;

  function release(): void {
    live = false;
    if (on && track !== null) {
      // A track that is already stopping may refuse this, and the stop must go on regardless.
      track.applyConstraints(torchConstraints(false)).catch(() => {});
    }
    track = null;
    on = false;
    torch.hidden = true;
    torch.setAttribute("aria-pressed", "false");
    torch.removeEventListener("click", toggle);
    if (stream !== null) stopTracks(stream);
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  }

  /** The button turns the torch the other way. It reads the change only once the track takes it. */
  function toggle(): void {
    const current = track;
    if (current === null) return;
    const want = !on;
    current.applyConstraints(torchConstraints(want)).then(
      () => {
        if (!live || track !== current) return;
        on = want;
        torch.setAttribute("aria-pressed", String(want));
      },
      // A refused torch is no failure of the scan: the scan runs on and the button stays as it was.
      (_error: unknown) => {},
    );
  }

  function finish(outcome?: ScanEnd): void {
    release();
    ended(outcome);
  }

  /** play() rejects when a newer load or a pause cut it short, which is no failure of the scan. */
  function playVideo(): void {
    video.play().catch((error: unknown) => {
      if (error instanceof DOMException && ["AbortError", "NotAllowedError"].includes(error.name)) {
        return;
      }
      if (live) finish({ why: DID_NOT_START });
    });
  }

  // A tab shown again does not restart the camera: the user presses Scan for that.
  function onVisibility(): void {
    if (document.hidden) finish();
  }

  function tick(decode: Decoder): void {
    timer = undefined;
    // The panel is gone when the card closed it or the editor view went, so the camera goes with it.
    if (!root.isConnected) {
      finish();
      return;
    }
    // A card rebuild moves the panel, and the browser pauses a video it moves.
    if (video.paused) playVideo();
    decode(video).then(
      (code) => {
        if (!live) return;
        if (code === null) {
          timer = setTimeout(() => tick(decode), SCAN_MS);
          return;
        }
        // The buzz is for the hit alone; a phone that cannot buzz still reads the code.
        if ("vibrate" in navigator) navigator.vibrate(50);
        finish({ code });
      },
      // A decoder that fails must not leave the camera running, so the scan ends and says so.
      () => {
        if (live) finish({ why: "The barcode reader failed; type the barcode instead" });
      },
    );
  }

  function attach(granted: MediaStream): void {
    // A camera granted after the scan was stopped is no one's, so its tracks stop at once.
    if (!live) {
      stopTracks(granted);
      return;
    }
    stream = granted;
    video.srcObject = granted;
    video.hidden = false;
    const found = granted.getVideoTracks()[0];
    // Only a track that names a torch in its capabilities gets the button; others never see it.
    if (found !== undefined && typeof found.getCapabilities === "function") {
      const capabilities: MediaTrackCapabilities & { torch?: boolean } = found.getCapabilities();
      if (capabilities.torch) {
        track = found;
        torch.hidden = false;
        torch.setAttribute("aria-pressed", "false");
        torch.addEventListener("click", toggle);
      }
    }
    playVideo();
    decoderFor().then(
      (decode) => {
        if (live) tick(decode);
      },
      () => {
        if (live) finish({ why: "The barcode reader did not load; type the barcode instead" });
      },
    );
  }

  document.addEventListener("visibilitychange", onVisibility);
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
    .then(attach, (error: unknown) => {
      if (live) finish({ why: cameraWords(error) });
    });

  return () => {
    if (live) release();
  };
}
