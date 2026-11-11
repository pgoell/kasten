/**
 * The session screen: one exercise at a time over the whole window, every set written to the
 * daily note the moment it is done. The note is the only record; closing loses nothing.
 */

import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { Awake, ring } from "@/lib/core/awake";
import {
  type Exercise,
  fetchEarlier,
  fetchExercises,
  lastTime,
  matches,
  recentNames,
  type TrainingDay,
} from "@/lib/log/training/exercises";
import {
  type CardioKind,
  cardioEdit,
  dayLabel,
  heldEdit,
  setEdit,
  setLabel,
  setsOf,
  trainingLines,
} from "@/lib/log/training/session-lines";
import { button, choiceRow, clock, element, stepperRow } from "@/lib/log/training/session-parts";
import type { Edit } from "@/lib/notes/text/note-section";

export const REST_SECONDS = 120;
export const REST_MORE = 30;
const KG_STEP = 2.5;
const LISTED = 40;
const RPES = [7, 8, 9, 10].map((value) => ({ value, text: String(value) }));
const CARDIO: { value: CardioKind; text: string; note: string }[] = [
  { value: "walk", text: "Walk", note: "Gehen" },
  { value: "run", text: "Run", note: "Joggen" },
  { value: "ride", text: "Ride", note: "Radfahren" },
];

interface Form {
  kg: number | null;
  reps: number;
  rpe: number | null;
  seconds: number;
  cardio: CardioKind;
  minutes: number;
  km: number;
}

/** Opens the session over the page for the daily note in `view`, and answers its close. */
export function openSession(view: EditorView, day: string): () => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let exercises: Exercise[] | null = null;
  let earlier: TrainingDay[] = [];
  let failed: string | null = null;
  let current: Exercise | null = null;
  let query = "";
  const worked: string[] = [];
  const form: Form = {
    kg: 20,
    reps: 8,
    rpe: null,
    seconds: 45,
    cardio: "walk",
    minutes: 30,
    km: 0,
  };
  let rest: { endsAt: number; after: number } | null = null;
  let tick: ReturnType<typeof setInterval> | undefined;

  const root = element("div", "k-train");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Training session");
  root.tabIndex = -1;
  const lock = element("span", "k-train-lock", "Asking to keep the screen on…");
  const awake = new Awake((held) => {
    lock.textContent = held ? "Screen stays on" : "The screen may turn off";
  });
  const close = () => {
    clearInterval(tick);
    awake.release();
    document.removeEventListener("keydown", keys, true);
    root.remove();
    opener?.focus();
  };
  const head = element("div", "k-train-head");
  head.append(button("k-train-close", "Done", close), lock);
  const progress = element("div", "k-train-progress");
  progress.setAttribute("aria-hidden", "true");
  const body = element("div", "k-train-body");
  const restBar = element("div", "k-train-rest");
  restBar.setAttribute("aria-live", "polite");
  root.append(head, progress, body, restBar);

  const text = () => view.state.doc.toString();

  function write(edit: Edit): void {
    view.dispatch({
      changes: edit,
      userEvent: "input.training",
      // Each set its own undo step, however fast the taps come.
      annotations: isolateHistory.of("full"),
    });
  }

  function start(exercise: Exercise): void {
    current = exercise;
    if (!worked.includes(exercise.name)) worked.push(exercise.name);
    const done = setsOf(text(), exercise.name).at(-1);
    const last = lastTime(earlier, exercise.name)?.entries.at(-1);
    const kg = done?.kg ?? last?.kg ?? null;
    form.kg = exercise.counts === "weight-reps" ? (kg ?? 20) : null;
    form.reps = done?.reps ?? last?.reps?.[0] ?? 8;
    form.seconds = done?.seconds ?? last?.seconds ?? 45;
    form.rpe = null;
    const cardio = CARDIO.find((c) => c.note === exercise.name);
    if (cardio !== undefined) form.cardio = cardio.value;
    paint();
  }

  function pick(): void {
    current = null;
    paint();
  }

  function setDone(): void {
    if (current === null) return;
    const name = current.name;
    write(
      current.counts === "time"
        ? heldEdit(text(), name, form.seconds)
        : setEdit(text(), { exercise: name, kg: form.kg, reps: form.reps, rpe: form.rpe }),
    );
    rest = { endsAt: Date.now() + REST_SECONDS * 1000, after: setsOf(text(), name).length };
    clearInterval(tick);
    tick = setInterval(count, 250);
    paint();
  }

  function count(): void {
    if (rest !== null && rest.endsAt <= Date.now()) {
      clearInterval(tick);
      ring();
    }
    paintRest();
  }

  function paintRest(): void {
    restBar.replaceChildren();
    restBar.hidden = rest === null;
    if (rest === null) return;
    const left = (rest.endsAt - Date.now()) / 1000;
    const words = element("div", "k-train-rest-words");
    words.append(
      element(
        "span",
        "k-train-rest-after",
        left > 0 ? `Rest after set ${rest.after}` : "Rest over",
      ),
      element("span", "k-train-rest-clock", clock(left)),
    );
    const more = button("k-train-rest-more", `+${REST_MORE} s`, () => {
      if (rest === null) return;
      rest = { ...rest, endsAt: Math.max(rest.endsAt, Date.now()) + REST_MORE * 1000 };
      clearInterval(tick);
      tick = setInterval(count, 250);
      paintRest();
    });
    const go = button("k-train-rest-go", "Go", () => {
      rest = null;
      clearInterval(tick);
      paintRest();
    });
    restBar.append(words, more, go);
  }

  function paintProgress(): void {
    const names =
      current !== null && !worked.includes(current.name) ? [...worked, current.name] : worked;
    progress.replaceChildren(
      ...names.map((name) => {
        const segment = element("span", "k-train-segment");
        segment.classList.toggle("is-now", name === current?.name);
        segment.classList.toggle("is-done", name !== current?.name);
        return segment;
      }),
    );
  }

  function choices(): HTMLElement[] {
    if (exercises === null) return [element("p", "k-train-wait", failed ?? "Loading exercises…")];
    const usable = exercises.filter((e) => e.kind !== "test");
    const byName = new Map(usable.map((e) => [e.name, e]));
    const today = [...new Set(trainingLines(text()).map(({ entry }) => entry.exercise))];
    const lists: [string, Exercise[]][] = [];
    if (query.trim() === "") {
      const named = (names: string[]) =>
        names.flatMap((name) => byName.get(name) ?? []).slice(0, LISTED);
      lists.push(["Today", named(today)], ["Recent", named(recentNames(earlier))]);
    }
    const found = usable.filter((e) => matches(e, query));
    lists.push([query.trim() === "" ? "All" : "Found", found.slice(0, LISTED)]);
    return lists
      .filter(([, list]) => list.length > 0)
      .map(([title, list]) => {
        const section = element("section", "k-train-list");
        section.append(element("h2", "k-train-where", title));
        for (const exercise of list) {
          const item = button("k-train-item", "", () => start(exercise));
          item.append(
            element("span", "k-train-item-name", exercise.name),
            element("span", "k-train-item-meta", exercise.muscles_primary.join(", ")),
          );
          section.append(item);
        }
        return section;
      });
  }

  function paintPick(): void {
    const search = element("input", "k-train-search");
    search.type = "search";
    search.placeholder = "Find an exercise";
    search.setAttribute("aria-label", "Find an exercise");
    search.value = query;
    const lists = element("div", "k-train-lists");
    lists.append(...choices());
    search.addEventListener("input", () => {
      query = search.value;
      lists.replaceChildren(...choices());
    });
    const cardio = element("div", "k-train-row k-train-choices");
    for (const kind of CARDIO) {
      const found = exercises?.find((e) => e.name === kind.note);
      const shortcut: Exercise = found ?? {
        path: "",
        name: kind.note,
        kind: "cardio",
        counts: "time",
        aliases: [],
        muscles_primary: [],
        muscles_secondary: [],
        equipment: [],
      };
      cardio.append(button("k-train-choice", kind.text, () => start(shortcut)));
    }
    body.replaceChildren(element("h1", "k-train-title", "Pick an exercise"), cardio, search, lists);
  }

  function paintCardio(exercise: Exercise): void {
    const save = button("k-train-done", "Save", () => {
      write(
        cardioEdit(text(), form.cardio, exercise.name, form.minutes, form.km > 0 ? form.km : null),
      );
      pick();
    });
    body.replaceChildren(
      element("p", "k-train-where", "Cardio"),
      element("h1", "k-train-title", exercise.name),
      choiceRow(
        "Kind",
        CARDIO,
        () => form.cardio,
        (value) => {
          if (value !== null) form.cardio = value;
        },
      ),
      stepperRow({
        label: "Minutes",
        value: () => form.minutes,
        step: 5,
        min: 1,
        max: 600,
        unit: " min",
        set: (v) => {
          form.minutes = v;
        },
      }),
      stepperRow({
        label: "Distance",
        value: () => form.km,
        step: 0.5,
        min: 0,
        max: 300,
        unit: " km",
        set: (v) => {
          form.km = v;
        },
      }),
      save,
      button("k-train-skip", "Back to exercises", pick),
    );
  }

  function paintExercise(exercise: Exercise): void {
    const sets = setsOf(text(), exercise.name);
    const last = lastTime(earlier, exercise.name);
    const panel = element("div", "k-train-panel");
    if (exercise.counts === "weight-reps") {
      panel.append(
        stepperRow({
          label: "Weight",
          value: () => form.kg ?? 0,
          step: KG_STEP,
          min: KG_STEP,
          max: 500,
          unit: " kg",
          set: (v) => {
            form.kg = v;
          },
        }),
      );
    }
    if (exercise.counts === "time") {
      panel.append(
        stepperRow({
          label: "Time",
          value: () => form.seconds,
          step: 5,
          min: 5,
          max: 600,
          unit: " s",
          set: (v) => {
            form.seconds = v;
          },
        }),
      );
    } else {
      panel.append(
        stepperRow({
          label: "Reps",
          value: () => form.reps,
          step: 1,
          min: 1,
          max: 100,
          unit: "",
          set: (v) => {
            form.reps = v;
          },
        }),
      );
    }
    panel.append(
      choiceRow(
        "RPE",
        RPES,
        () => form.rpe,
        (value) => {
          form.rpe = value;
        },
      ),
    );
    const list = element("ol", "k-train-sets");
    for (const [at, set] of sets.entries()) {
      const item = element("li", "k-train-set");
      item.append(element("span", "", `Set ${at + 1}`), element("span", "", setLabel(set)));
      list.append(item);
    }
    const lastLine = element(
      "p",
      "k-train-last",
      last === null ? "" : `Last time ${dayLabel(last.entries)}`,
    );
    lastLine.hidden = last === null;
    const where = `Exercise ${worked.indexOf(exercise.name) + 1} · set ${sets.length + 1}`;
    body.replaceChildren(
      element("p", "k-train-where", where),
      element("h1", "k-train-title", exercise.name),
      panel,
      list,
      lastLine,
      button("k-train-done", `Set done, rest ${clock(REST_SECONDS)}`, setDone),
      button("k-train-skip", sets.length === 0 ? "Skip exercise" : "Next exercise", pick),
    );
  }

  function paint(): void {
    paintProgress();
    paintRest();
    if (current === null) paintPick();
    else if (current.kind === "cardio") paintCardio(current);
    else paintExercise(current);
    if (root.isConnected && !root.contains(document.activeElement)) root.focus();
  }

  /** Tab and Shift+Tab go round the screen's controls, never out to the note behind. */
  function trap(event: KeyboardEvent): void {
    const controls = [...root.querySelectorAll<HTMLElement>("button, input")];
    const at = document.activeElement;
    const inside = at instanceof HTMLElement && at !== root && root.contains(at);
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    const wrap = event.shiftKey ? controls.at(-1) : controls[0];
    if (inside && at !== edge) return;
    event.preventDefault();
    wrap?.focus();
  }

  // On the document, since a repaint takes the focused button away and focus falls to the body.
  function keys(event: KeyboardEvent): void {
    if (event.key === "Tab") {
      trap(event);
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (current === null) close();
    else pick();
  }

  Promise.all([fetchExercises(), fetchEarlier(day)]).then(
    ([all, days]) => {
      exercises = all;
      earlier = days;
      if (current === null && root.isConnected) paint();
    },
    (error: unknown) => {
      if (!(error instanceof Error)) throw error;
      failed = `Could not load the exercises: ${error.message}`;
      if (current === null && root.isConnected) paint();
    },
  );

  paint();
  document.body.append(root);
  document.addEventListener("keydown", keys, true);
  root.focus();
  return close;
}
