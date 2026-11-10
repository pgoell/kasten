/**
 * A clock that crosses local midnight while the tests run, for #1315.
 *
 * Off unless `VITE_KASTEN_CROSS_MIDNIGHT` is set, which only
 * `frontend/scripts/cross-midnight.sh` does. A test that reads today once and compares
 * it with a date the code stamps later fails under one of the two modes:
 *
 * - `load`: the files load at 23:59:59 and every test runs at 00:00:01 the day
 *   after, which catches a date taken at the top of a file or a fixture.
 * - `test`: every test starts at 23:59:59 and the day turns as soon as the test
 *   file itself reads the clock, which catches a date taken inside a test.
 *
 * A test that pins its own clock with fake timers or `vi.setSystemTime` wins
 * over this, since its hooks run after these.
 */

// `import.meta.env` rather than `process`, which the frame project's browser lacks.
const mode = import.meta.env.VITE_KASTEN_CROSS_MIDNIGHT;

if (mode === "load" || mode === "test") {
  const RealDate = Date;
  const today = new RealDate();
  const midnight = new RealDate(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  ).getTime();
  let offset = 0;
  let turned = false;

  const setNow = (at: number) => {
    offset = at - RealDate.now();
  };

  // Only a read from a test file turns the day: the stack names the caller.
  const readByTest = () =>
    /\/tests\//.test(new Error().stack?.split("\n").slice(3, 5).join("\n") ?? "");

  const now = () => {
    const at = RealDate.now() + offset;
    if (mode === "test" && !turned && readByTest()) {
      turned = true;
      setNow(midnight + 1000);
    }
    return at;
  };

  class CrossingDate extends RealDate {
    constructor(...args: ConstructorParameters<DateConstructor> | []) {
      if (args.length === 0) super(now());
      else super(...(args as ConstructorParameters<DateConstructor>));
    }
    static override now() {
      return now();
    }
  }

  setNow(midnight - 1000);
  globalThis.Date = CrossingDate as DateConstructor;
  beforeEach(() => {
    globalThis.Date = CrossingDate as DateConstructor;
    turned = false;
    setNow(mode === "load" ? midnight + 1000 : midnight - 1000);
  });
}
