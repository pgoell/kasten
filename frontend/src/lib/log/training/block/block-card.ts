/**
 * The card under a training block's title: the calendar of its weeks with the exercise library
 * beside it on a wide pane, and from the block's last week on, the button that plans the next one.
 * Every change it makes is an edit to the note, so Obsidian sees the same block.
 */

import type { EditorState, Extension } from "@codemirror/state";
import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { createNote } from "@/lib/core/api";
import { readClock, shiftDay } from "@/lib/core/clock";
import { calendar, element, library, shortDate } from "@/lib/log/training/block/block-calendar";
import {
  addToDay,
  editBetween,
  nextBlockText,
  nextName,
} from "@/lib/log/training/block/block-edit";
import {
  type Block,
  endOf,
  isBlock,
  parseBlock,
  planOn,
} from "@/lib/log/training/block/block-note";
import { fetchBlocks, type HeldBlock, hasNext } from "@/lib/log/training/block/blocks";
import {
  type Exercise,
  fetchExercises,
  fetchTraining,
  type TrainingDay,
} from "@/lib/log/training/exercises";
import { cardLine } from "@/lib/notes/note/weather-card";
import { notePath } from "@/lib/todo/todo-commands";

const HEAD_CHARS = 2000;

interface Loaded {
  exercises: Exercise[];
  days: TrainingDay[];
  blocks: HeldBlock[];
}

interface Shown {
  loaded: Loaded | null;
  failed: string | null;
  muscle: string | null;
  picked: string | null;
  said: string | null;
  /** The next block's name once this card wrote it, so the button does not offer it twice. */
  planned: string | null;
}

const arrived = StateEffect.define<Loaded>();
const failed = StateEffect.define<string>();
const changed = StateEffect.define<Partial<Shown>>();

function today(): string {
  return readClock(new Date()).date;
}

/** Where the block stands today: its week and target, or when it starts or ended. */
function standing(block: Block, on: string): string {
  const plan = planOn(block, on);
  const count = block.weeks.length;
  if (plan !== null) {
    const week = block.weeks[plan.week];
    const target = week?.deload ? "deload" : week?.rpe ? `RPE ${week.rpe}` : "build";
    const session = plan.letter === null ? "rest day" : `session ${plan.letter} today`;
    return `Week ${plan.week + 1} of ${count} · ${target} · ${session}`;
  }
  if (on < block.start) return `${count} weeks from ${shortDate(block.start)}`;
  return `Ended ${shortDate(endOf(block))}`;
}

function folderOf(view: EditorView): string {
  const path = view.state.facet(notePath) ?? "";
  return path.slice(0, path.lastIndexOf("/") + 1);
}

function nameOf(view: EditorView): string {
  const title = /^#\s+(.+?)\s*$/mu.exec(view.state.doc.sliceString(0, HEAD_CHARS))?.[1];
  return title ?? "Block";
}

function nextButton(view: EditorView, block: Block, loaded: Loaded): HTMLElement {
  const next = element("button", "cm-block-next", "Plan next block");
  next.type = "button";
  next.addEventListener("click", () => {
    const text = nextBlockText(view.state.doc.toString(), block, loaded.days, today());
    const start = parseBlock(text)?.start ?? block.start;
    const name = nextName(nameOf(view), start);
    const body = text.replace(/^#\s+.+$/mu, `# ${name}`);
    next.disabled = true;
    createNote(`${folderOf(view)}${name}.md`, body).then(
      () => view.dispatch({ effects: changed.of({ said: `Wrote [[${name}]]`, planned: name }) }),
      (error: unknown) => {
        if (!(error instanceof Error)) throw error;
        next.disabled = false;
        view.dispatch({ effects: changed.of({ said: error.message }) });
      },
    );
  });
  return next;
}

class BlockCard extends WidgetType {
  private readonly block: Block;
  private readonly shown: Shown;
  private readonly text: string;

  constructor(block: Block, shown: Shown, text: string) {
    super();
    this.block = block;
    this.shown = shown;
    this.text = text;
  }

  override eq(other: BlockCard): boolean {
    return other.text === this.text && other.shown === this.shown;
  }

  toDOM(view: EditorView): HTMLElement {
    const { block, shown } = this;
    const on = today();
    const card = element("div", "cm-block");
    card.setAttribute("contenteditable", "false");
    card.append(element("p", "cm-block-standing", standing(block, on)));
    const add = (weekday: number, name: string) => {
      const exercise = shown.loaded?.exercises.find((e) => e.name === name);
      const text = view.state.doc.toString();
      const after = addToDay(text, block, weekday, {
        name,
        counts: exercise?.counts ?? "weight-reps",
      });
      view.dispatch({ changes: editBetween(text, after), effects: changed.of({ picked: null }) });
    };
    const body = element("div", "cm-block-body");
    body.append(
      calendar({
        block,
        days: shown.loaded?.days ?? [],
        today: on,
        picking: shown.picked !== null,
        onDay: (weekday, dropped) => {
          const name = dropped ?? shown.picked;
          if (name !== null) add(weekday, name);
        },
      }),
    );
    if (shown.loaded !== null) {
      body.append(
        library({
          exercises: shown.loaded.exercises,
          muscle: shown.muscle,
          picked: shown.picked,
          onMuscle: (muscle) => view.dispatch({ effects: changed.of({ muscle }) }),
          onPick: (picked) => view.dispatch({ effects: changed.of({ picked }) }),
        }),
      );
    }
    card.append(body);
    if (shown.picked !== null) {
      card.append(element("p", "cm-block-said", `Pick a day for ${shown.picked}`));
    }
    const lastWeek = shiftDay(endOf(block), -6);
    const offer = shown.planned === null && !hasNext(shown.loaded?.blocks ?? [], block);
    if (shown.loaded !== null && on >= lastWeek && offer) {
      card.append(nextButton(view, block, shown.loaded));
    }
    const words = shown.said ?? shown.failed;
    if (words !== null) card.append(element("p", "cm-block-said", words));
    return card;
  }
}

interface Card extends Shown {
  decorations: DecorationSet;
}

function build(state: EditorState, shown: Shown): Card {
  const text = state.doc.toString();
  const block = isBlock(text.slice(0, HEAD_CHARS)) ? parseBlock(text) : null;
  const line = block === null ? null : cardLine(state.doc);
  if (block === null || line === null) return { ...shown, decorations: Decoration.none };
  const widget = new BlockCard(block, shown, text);
  return {
    ...shown,
    decorations: Decoration.set([
      Decoration.widget({ widget, block: true, side: 1 }).range(state.doc.line(line).to),
    ]),
  };
}

const field = StateField.define<Card>({
  create: (state) =>
    build(state, {
      loaded: null,
      failed: null,
      muscle: null,
      picked: null,
      said: null,
      planned: null,
    }),
  update(value, tr) {
    let next: Shown = value;
    for (const effect of tr.effects) {
      if (effect.is(arrived)) next = { ...next, loaded: effect.value, failed: null };
      if (effect.is(failed)) next = { ...next, failed: effect.value };
      if (effect.is(changed)) next = { ...next, ...effect.value };
    }
    return next !== value || tr.docChanged ? build(tr.state, next) : value;
  },
  provide: (card) => EditorView.decorations.from(card, (value) => value.decorations),
});

/** Loads the exercises, the block's days and the other blocks, again when the dates change. */
const loader = ViewPlugin.fromClass(
  class {
    private asked = "";
    private readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.load();
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.load();
    }

    load(): void {
      const head = this.view.state.doc.sliceString(0, HEAD_CHARS);
      const block = isBlock(head) ? parseBlock(this.view.state.doc.toString()) : null;
      if (block === null) return;
      const end = endOf(block);
      const key = `${block.start} ${end}`;
      if (key === this.asked) return;
      this.asked = key;
      Promise.all([fetchExercises(), fetchTraining(block.start, end), fetchBlocks()]).then(
        ([exercises, days, blocks]) => {
          if (this.asked === key)
            this.view.dispatch({ effects: arrived.of({ exercises, days, blocks }) });
        },
        (error: unknown) => {
          if (!(error instanceof Error)) throw error;
          this.asked = "";
          this.view.dispatch({ effects: failed.of(`Could not load the block: ${error.message}`) });
        },
      );
    }
  },
);

/** The card as an editor extension: a field for the block widget, a plugin for the reads. */
export const blockCard: Extension = [field, loader];
