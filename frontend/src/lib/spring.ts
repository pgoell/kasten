/**
 * The springs of the redesign, and the motion they drive.
 *
 * A spring is a response time and a damping, which is how Apple's
 * `Spring(response:dampingRatio:)` states one. The numbers here are the tokens
 * in `kasten-theme.css`, and a test holds them equal.
 */

export interface SpringConfig {
  damping: number;
  /** The period of the spring, in seconds. */
  response: number;
}

export const SPRINGS = {
  default: { damping: 1, response: 0.32 },
  sheetOpen: { damping: 1, response: 0.35 },
  /** Closes and springs back, so it is never slower than the sheet opening. */
  sheetClose: { damping: 1, response: 0.3 },
  tab: { damping: 1, response: 0.32 },
  split: { damping: 1, response: 0.34 },
  card: { damping: 1, response: 0.26 },
};

/** Damping 1 settles without overshoot. 0.8 lets a flick carry past and back. */
export const FLICK_DAMPING = 0.8;

/** Above this speed, in px/s, a release counts as a flick. */
export const FLICK_SPEED = 400;

/** A release faster than a flick bounces a little, so the flick feels thrown. */
export function afterRelease(config: SpringConfig, velocity: number): SpringConfig {
  return Math.abs(velocity) > FLICK_SPEED ? { ...config, damping: FLICK_DAMPING } : config;
}

/**
 * Where a spring is `t` seconds after it starts from `from` moving at
 * `velocity`, heading for `target`, and how fast it is moving then.
 *
 * The velocity is the derivative of the position, worked out by hand rather
 * than by differencing two frames, so a frame that comes late costs nothing.
 */
export function springAt(
  from: number,
  velocity: number,
  target: number,
  config: SpringConfig,
  t: number,
): { value: number; velocity: number } {
  const omega = (2 * Math.PI) / config.response;
  const displacement = from - target;

  // Damping 1 is the critical case. Nothing in the redesign goes above it.
  if (config.damping >= 1) {
    const decay = Math.exp(-omega * t);
    const carried = velocity + omega * displacement;
    return {
      value: target + (displacement + carried * t) * decay,
      velocity: decay * (velocity - omega * carried * t),
    };
  }

  const z = config.damping;
  const wd = omega * Math.sqrt(1 - z * z);
  const decay = Math.exp(-z * omega * t);
  const cos = Math.cos(wd * t);
  const sin = Math.sin(wd * t);
  const b = (velocity + z * omega * displacement) / wd;
  return {
    value: target + decay * (displacement * cos + b * sin),
    velocity:
      decay *
      ((b * wd - z * omega * displacement) * cos + (-displacement * wd - z * omega * b) * sin),
  };
}

type FrameRequest = (cb: (now: number) => void) => number;

interface Run {
  from: number;
  velocity: number;
  target: number;
  config: SpringConfig;
  /** ms, the clock's reading when the run began. */
  at: number;
}

/**
 * One animated number. It is driven by frames, but input never waits on it:
 * `set` takes the value at once, so a finger lands mid-flight.
 */
export class Spring {
  private current: number;
  private speed = 0;
  private run: Run | null = null;
  private settle: ((done: boolean) => void) | null = null;
  private handle: number | null = null;

  private readonly onFrame: (value: number) => void;
  private readonly frame: FrameRequest;
  private readonly cancel: (id: number) => void;
  private readonly now: () => number;
  private readonly reduced: () => boolean;

  constructor(
    value: number,
    onFrame: (value: number) => void,
    options: {
      frame?: FrameRequest;
      cancel?: (id: number) => void;
      now?: () => number;
      reduced?: () => boolean;
    } = {},
  ) {
    this.current = value;
    this.onFrame = onFrame;
    this.frame = options.frame ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = options.cancel ?? ((id) => cancelAnimationFrame(id));
    this.now = options.now ?? (() => performance.now());
    this.reduced =
      options.reduced ?? (() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  get value(): number {
    return this.current;
  }

  get velocity(): number {
    return this.speed;
  }

  get moving(): boolean {
    return this.run !== null;
  }

  /**
   * Starts toward `target` from the current value and speed, so a spring already
   * running is caught and turned round. Resolves false if another `to`, `set` or
   * `stop` interrupts it first.
   */
  to(target: number, config: SpringConfig, velocity?: number): Promise<boolean> {
    this.end(false);
    // Reduced motion gets the end state at once: no movement is the point of it.
    if (this.reduced()) {
      this.put(target, 0);
      return Promise.resolve(true);
    }
    this.run = {
      from: this.current,
      velocity: velocity ?? this.speed,
      target,
      config,
      at: this.now(),
    };
    const done = new Promise<boolean>((resolve) => {
      this.settle = resolve;
    });
    this.handle = this.frame((now) => this.step(now));
    return done;
  }

  /** Puts the value there at once and stops any motion. A finger takes over this way. */
  set(value: number, velocity = 0): void {
    this.end(false);
    this.put(value, velocity);
  }

  stop(): void {
    this.end(false);
  }

  private step(now: number): void {
    const run = this.run;
    if (!run) return;
    this.handle = null;
    // A frame can be stamped before `to` read the clock, so a negative elapsed
    // time would run the spring backwards: it starts where it began instead.
    const elapsed = Math.max(0, (now - run.at) / 1000);
    const at = springAt(run.from, run.velocity, run.target, run.config, elapsed);
    // Close enough to stop: snap to the target so it rests exactly on it.
    if (Math.abs(at.value - run.target) < 0.5 && Math.abs(at.velocity) < 5) {
      this.put(run.target, 0);
      this.end(true);
      return;
    }
    this.current = at.value;
    this.speed = at.velocity;
    this.onFrame(at.value);
    this.handle = this.frame((next) => this.step(next));
  }

  private put(value: number, velocity: number): void {
    this.current = value;
    this.speed = velocity;
    this.onFrame(value);
  }

  private end(done: boolean): void {
    if (this.handle !== null) {
      this.cancel(this.handle);
      this.handle = null;
    }
    const settle = this.settle;
    this.run = null;
    this.settle = null;
    settle?.(done);
  }
}
