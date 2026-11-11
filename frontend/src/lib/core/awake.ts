/**
 * Keeping the screen on through the Wake Lock API, and ringing when a timer runs out: what cook
 * mode and the training session share, both used with wet or sweaty hands away from the screen.
 */

/** Holds a screen wake lock while it lives, and takes it again when the tab returns. */
export class Awake {
  private sentinel: WakeLockSentinel | null = null;
  private closed = false;
  private readonly said: (held: boolean) => void;

  constructor(said: (held: boolean) => void) {
    this.said = said;
    document.addEventListener("visibilitychange", this.again);
    void this.take();
  }

  private readonly again = () => {
    if (document.visibilityState === "visible" && this.sentinel === null) void this.take();
  };

  private async take(): Promise<void> {
    if (!("wakeLock" in navigator)) {
      this.said(false);
      return;
    }
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (this.closed) {
        await sentinel.release();
        return;
      }
      this.sentinel = sentinel;
      this.said(true);
      // The browser lets go when the tab is hidden; `again` takes it back on return.
      sentinel.addEventListener("release", () => {
        this.sentinel = null;
        if (!this.closed) this.said(false);
      });
    } catch (error) {
      // NotAllowedError: a low battery, a policy, or a page that is not visible.
      if (!(error instanceof DOMException)) throw error;
      this.said(false);
    }
  }

  release(): void {
    this.closed = true;
    document.removeEventListener("visibilitychange", this.again);
    void this.sentinel?.release();
    this.sentinel = null;
  }
}

/** Three short pulses and a tone when a timer runs out, where the device has either. */
export function ring(): void {
  navigator.vibrate?.([300, 150, 300, 150, 300]);
  if (typeof AudioContext === "undefined") return;
  const audio = new AudioContext();
  const tone = audio.createOscillator();
  tone.frequency.value = 880;
  tone.connect(audio.destination);
  tone.start();
  tone.stop(audio.currentTime + 0.6);
  tone.addEventListener("ended", () => void audio.close());
}
