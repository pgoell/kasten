/**
 * Cook mode: a recipe one step at a time, dark and over the whole window, with the screen kept
 * on through the Wake Lock API. A step's ingredients come scaled to the servings it opened with.
 */

import type { Recipe } from "@/lib/log/food-api";
import {
  clock,
  lastNote,
  scaledLine,
  shown,
  stepIngredients,
  stepSeconds,
} from "@/lib/log/recipe/recipe-steps";

export interface CookInput {
  title: string;
  recipe: Recipe;
  /** The servings the card showed, which may differ from the note's. */
  servings: number | null;
}

interface Timer {
  step: number;
  seconds: number;
  /** When it ends, while it runs; null while it is paused or done. */
  endsAt: number | null;
  left: number;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const made = element("button", className, text);
  made.type = "button";
  made.addEventListener("click", onClick);
  return made;
}

/** Holds a screen wake lock while cook mode is open, and takes it again when the tab returns. */
class Awake {
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
function ring(): void {
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

/** Opens cook mode over the page, and answers a function that closes it. */
export function openCookMode({ title, recipe, servings }: CookInput): () => void {
  const steps = recipe.steps;
  const factor = servings === null || recipe.servings === null ? 1 : servings / recipe.servings;
  const note = lastNote(recipe.cooked);
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let index = 0;
  let timer: Timer | null = null;
  let tick: ReturnType<typeof setInterval> | undefined;

  const root = element("div", "k-cook");
  root.dataset.theme = "dark";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", `Cook ${title}`);

  const close = () => {
    clearInterval(tick);
    awake.release();
    root.remove();
    opener?.focus();
  };

  const lock = element("span", "k-cook-lock", "Asking to keep the screen on…");
  lock.setAttribute("aria-live", "polite");
  const awake = new Awake((held) => {
    lock.textContent = held ? "Screen stays on" : "The screen may turn off";
  });
  const head = element("div", "k-cook-head");
  const chip = button("k-cook-chip", "", () => go(timer?.step ?? index));
  head.append(button("k-cook-close", "Close", close), chip, lock);

  const progress = element("div", "k-cook-progress");
  progress.setAttribute("aria-hidden", "true");
  const segments = steps.map(() => progress.appendChild(element("span", "k-cook-segment")));
  const where = element("p", "k-cook-where");
  const text = element("p", "k-cook-step");
  text.setAttribute("aria-live", "polite");
  const uses = element("section", "k-cook-uses");
  const clockButton = button("k-cook-timer", "", () => press());
  const last = element("p", "k-cook-last", note === null ? "" : `Last time: ${note}`);
  last.hidden = note === null;
  const body = element("div", "k-cook-body");
  body.append(progress, where, text, uses, clockButton, last);

  const back = button("k-cook-back", "Back", () => go(index - 1));
  const next = button("k-cook-next", "Next step", () =>
    index === steps.length - 1 ? close() : go(index + 1),
  );
  const foot = element("div", "k-cook-foot");
  foot.append(back, next);
  root.append(head, body, foot);

  function step(): string {
    return steps[index] ?? "";
  }

  function left(): number {
    if (timer === null) return 0;
    return timer.endsAt === null ? timer.left : Math.max(0, (timer.endsAt - Date.now()) / 1000);
  }

  function press(): void {
    const seconds = stepSeconds(step());
    if (seconds === null) return;
    if (timer === null || timer.step !== index || left() === 0) {
      timer = { step: index, seconds, endsAt: Date.now() + seconds * 1000, left: seconds };
    } else if (timer.endsAt === null) {
      timer.endsAt = Date.now() + timer.left * 1000;
    } else {
      timer = { ...timer, left: left(), endsAt: null };
    }
    clearInterval(tick);
    tick = setInterval(count, 250);
    paint();
  }

  function count(): void {
    if (timer?.endsAt != null && left() === 0) {
      timer = { ...timer, left: 0, endsAt: null };
      clearInterval(tick);
      ring();
    }
    paint();
  }

  function go(to: number): void {
    index = Math.min(Math.max(0, to), steps.length - 1);
    paint();
  }

  function timerText(): string | null {
    const seconds = stepSeconds(step());
    if (seconds === null) return null;
    if (timer === null || timer.step !== index) return `Start ${clock(seconds)} timer`;
    const now = left();
    if (now === 0) return `Time's up · start ${clock(seconds)} again`;
    return timer.endsAt === null ? `Paused at ${clock(now)} · resume` : `${clock(now)} · pause`;
  }

  function paintUses(): void {
    const items = stepIngredients(step(), recipe.ingredients);
    uses.replaceChildren();
    if (items.length === 0) return;
    const amount = servings === null ? "" : ` · ${shown(servings, 2)} servings`;
    const list = element("ul", "k-cook-list");
    for (const item of items) list.append(element("li", "k-cook-item", scaledLine(item, factor)));
    uses.append(element("h2", "k-cook-label", `For this step${amount}`), list);
  }

  function paintTimer(): void {
    const label = timerText();
    clockButton.hidden = label === null;
    clockButton.textContent = label ?? "";
    clockButton.classList.toggle("is-up", timer?.step === index && left() === 0);
    chip.hidden = timer === null || timer.step === index;
    chip.textContent = timer === null ? "" : left() === 0 ? "Time's up" : `Timer ${clock(left())}`;
  }

  function paint(): void {
    for (const [at, segment] of segments.entries()) {
      segment.classList.toggle("is-done", at <= index);
    }
    where.textContent = `${title} · Step ${index + 1} of ${steps.length}`;
    text.textContent = step();
    paintUses();
    paintTimer();
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? "Done" : "Next step";
  }

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    else if (event.key === "ArrowRight") go(index + 1);
    else if (event.key === "ArrowLeft") go(index - 1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });

  paint();
  document.body.append(root);
  next.focus();
  return close;
}
