/**
 * The card under an exercise note's title: its video, its muscle map, and beside them on a wide
 * pane its history. On a phone the video leads and tabs pick muscles, cues or history; the cues are
 * the note's body, so that tab only folds the card away.
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
import { readClock, shiftDay } from "@/lib/core/clock";
import { element } from "@/lib/log/training/block/block-calendar";
import { fetchBlocks, type HeldBlock } from "@/lib/log/training/block/blocks";
import { historyPanel } from "@/lib/log/training/exercise/exercise-history";
import {
  type ExerciseNote,
  readExercise,
  type Video,
  videoOf,
} from "@/lib/log/training/exercise/exercise-note";
import { muscleMap } from "@/lib/log/training/exercise/muscle-map";
import { fetchTraining, type TrainingDay } from "@/lib/log/training/exercises";
import { weekStarts } from "@/lib/log/training/progress";
import { cardLine } from "@/lib/notes/note/weather-card";
import { notePath } from "@/lib/todo/todo-commands";

const HEAD_CHARS = 2000;
const HISTORY_DAYS = 365;
const TREND_WEEKS = 26;
const TABS = [
  ["muscles", "Muscles"],
  ["cues", "Cues"],
  ["history", "History"],
] as const;

type Tab = (typeof TABS)[number][0];

interface Loaded {
  days: TrainingDay[];
  blocks: HeldBlock[];
}

interface Shown {
  loaded: Loaded | null;
  failed: string | null;
  tab: Tab;
}

const arrived = StateEffect.define<Loaded>();
const failed = StateEffect.define<string>();
const picked = StateEffect.define<Tab>();

function today(): string {
  return readClock(new Date()).date;
}

/** The exercise a training line links: the note's file name, as `[[Kniebeuge]]` names it. */
function nameOf(state: EditorState): string {
  const path = state.facet(notePath) ?? "";
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/u, "");
}

function player(video: Video, name: string): HTMLElement {
  const box = element("div", "cm-exercise-video");
  if (video.kind === "file") {
    const file = element("video", "");
    file.src = video.src;
    file.controls = true;
    file.preload = "metadata";
    file.setAttribute("aria-label", `${name}, video`);
    box.append(file);
    return box;
  }
  const frame = element("iframe", "");
  frame.src = video.src;
  frame.title = `${name}, video`;
  frame.loading = "lazy";
  frame.allow = "encrypted-media; picture-in-picture; fullscreen";
  frame.allowFullscreen = true;
  // YouTube refuses to play an embed that sends no referrer.
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  box.append(frame);
  return box;
}

function tabs(view: EditorView, shown: Shown): HTMLElement {
  const bar = element("div", "cm-exercise-tabs");
  bar.setAttribute("role", "tablist");
  for (const [tab, label] of TABS) {
    const button = element("button", "cm-exercise-tab", label);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tab === shown.tab));
    button.addEventListener("click", () => view.dispatch({ effects: picked.of(tab) }));
    bar.append(button);
  }
  return bar;
}

class ExerciseCard extends WidgetType {
  private readonly note: ExerciseNote;
  private readonly name: string;
  private readonly shown: Shown;
  private readonly key: string;

  constructor(note: ExerciseNote, name: string, shown: Shown) {
    super();
    this.note = note;
    this.name = name;
    this.shown = shown;
    // Typing in the body changes neither, so the video keeps playing.
    this.key = JSON.stringify([note, name]);
  }

  override eq(other: ExerciseCard): boolean {
    const [a, b] = [other.shown, this.shown];
    return (
      other.key === this.key && a.loaded === b.loaded && a.failed === b.failed && a.tab === b.tab
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const card = element("div", "cm-exercise");
    card.setAttribute("contenteditable", "false");
    card.dataset.key = this.key;
    const video = videoOf(this.note.video);
    if (video !== null) card.append(player(video, this.name));
    this.fill(card, view);
    return card;
  }

  /** Redraws all but the video when only the history or the tab changed, so it keeps playing. */
  override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (dom.dataset.key !== this.key) return false;
    for (const child of [...dom.children]) {
      if (!child.classList.contains("cm-exercise-video")) child.remove();
    }
    this.fill(dom, view);
    return true;
  }

  private fill(card: HTMLElement, view: EditorView): void {
    const { note, name, shown } = this;
    card.dataset.tab = shown.tab;
    card.append(tabs(view, shown));
    const body = element("div", "cm-exercise-body");
    const map = muscleMap(note.primary, note.secondary);
    map.dataset.panel = "muscles";
    body.append(map);
    if (shown.loaded !== null) {
      body.append(
        historyPanel({
          exercise: name,
          strength: note.kind === "strength",
          days: shown.loaded.days,
          blocks: shown.loaded.blocks,
          starts: weekStarts(today(), TREND_WEEKS),
        }),
      );
    }
    card.append(body);
    if (shown.failed !== null) card.append(element("p", "cm-exercise-quiet", shown.failed));
  }
}

interface Card extends Shown {
  decorations: DecorationSet;
}

function build(state: EditorState, shown: Shown): Card {
  const note = readExercise(state.doc.sliceString(0, HEAD_CHARS));
  const line = note === null ? null : cardLine(state.doc);
  if (note === null || line === null) return { ...shown, decorations: Decoration.none };
  const widget = new ExerciseCard(note, nameOf(state), shown);
  return {
    ...shown,
    decorations: Decoration.set([
      Decoration.widget({ widget, block: true, side: 1 }).range(state.doc.line(line).to),
    ]),
  };
}

const field = StateField.define<Card>({
  create: (state) => build(state, { loaded: null, failed: null, tab: "muscles" }),
  update(value, tr) {
    let next: Shown = value;
    for (const effect of tr.effects) {
      if (effect.is(arrived)) next = { ...next, loaded: effect.value, failed: null };
      if (effect.is(failed)) next = { ...next, failed: effect.value };
      if (effect.is(picked)) next = { ...next, tab: effect.value };
    }
    return next !== value || tr.docChanged ? build(tr.state, next) : value;
  },
  provide: (card) => EditorView.decorations.from(card, (value) => value.decorations),
});

/** Loads a year of training and the block notes once the note reads as an exercise. */
const loader = ViewPlugin.fromClass(
  class {
    private asked = false;
    private readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.load();
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.load();
    }

    load(): void {
      if (this.asked || readExercise(this.view.state.doc.sliceString(0, HEAD_CHARS)) === null) {
        return;
      }
      this.asked = true;
      const to = today();
      Promise.all([fetchTraining(shiftDay(to, -HISTORY_DAYS), to), fetchBlocks()]).then(
        ([days, blocks]) => this.view.dispatch({ effects: arrived.of({ days, blocks }) }),
        (error: unknown) => {
          if (!(error instanceof Error)) throw error;
          this.asked = false;
          this.view.dispatch({
            effects: failed.of(`Could not load the history: ${error.message}`),
          });
        },
      );
    }
  },
);

/** The card as an editor extension: a field for the widget, a plugin for the reads. */
export const exerciseCard: Extension = [field, loader];
