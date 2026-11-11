"""The exercise import on made-up wger and free-exercise-db rows, against a fake kasten."""

import json
from typing import Any

import httpx

from kasten_jobs.exercises.job import gather, named, run
from kasten_jobs.exercises.mobility import TESTS, mobility
from kasten_jobs.exercises.note import COUNTS, MUSCLES, Exercise, file_name, render
from kasten_jobs.exercises.sources import FREE_DB, cues, from_wger
from kasten_jobs.kasten_api import KastenApi

LICENCE = {"short_name": "CC-BY-SA 4", "url": "https://creativecommons.org/licenses/by-sa/4.0/"}


def wger_row(row_id: int, german: str | None, english: str, **fields: Any) -> dict[str, Any]:
    translations = [{"language": 2, "name": english, "description": "", "aliases": []}]
    if german is not None:
        translations.append(
            {
                "language": 1,
                "name": german,
                "description": fields.pop("description", ""),
                "aliases": [{"alias": a} for a in fields.pop("aliases", [])],
                "author_history": ["anna"],
            }
        )
    return {
        "id": row_id,
        "category": {"name": fields.pop("category", "Chest")},
        "muscles": [{"id": m} for m in fields.pop("muscles", [4])],
        "muscles_secondary": [{"id": m} for m in fields.pop("secondary", [])],
        "equipment": [{"name": e} for e in fields.pop("equipment", ["Barbell"])],
        "license": LICENCE,
        "author_history": ["ben"],
        "translations": translations,
        "videos": fields.pop("videos", []),
    }


BENCH = wger_row(
    192,
    "Bankdrücken LH",
    "Bench Press",
    secondary=[5, 2],
    equipment=["Barbell", "Bench"],
    aliases=["Flachbankdrücken"],
    description="<p>Auf die Bank legen.</p><ol><li>Absenken</li><li>Drücken</li></ol>",
    videos=[{"video": "https://wger.de/a.mp4", "is_main": False}],
)
FREE_BENCH = {
    "name": "Bench Press",
    "category": "strength",
    "primaryMuscles": ["chest"],
    "secondaryMuscles": ["triceps", "lats"],
}


def test_a_wger_exercise_becomes_a_german_note_with_its_english_name_as_an_alias() -> None:
    exercise = from_wger(BENCH, {"benchpress": FREE_BENCH})

    assert exercise is not None
    assert exercise.name == "Bankdrücken LH"
    assert exercise.aliases == ("Bench Press", "Flachbankdrücken")
    assert exercise.muscles_primary == ("chest",)
    assert exercise.muscles_secondary == ("triceps", "front-deltoids", "upper-back")
    assert exercise.equipment == ("Langhantel", "Bank")
    assert (exercise.kind, exercise.counts) == ("strength", "weight-reps")
    assert exercise.video == "https://wger.de/a.mp4"
    assert exercise.extra["license"] == "CC-BY-SA 4"
    assert "Übung von ben, Text von anna" in exercise.credit
    assert "free-exercise-db" in exercise.credit


def test_kind_and_counts_follow_the_name_the_category_and_the_equipment() -> None:
    def made(row: dict[str, Any]) -> Exercise:
        exercise = from_wger(row, {})
        assert exercise is not None
        return exercise

    stretch = made(wger_row(1, "Wadendehnung", "Calf Stretch", equipment=[]))
    plank = made(wger_row(2, "Unterarmstütz", "Plank", equipment=["Gym mat"]))
    pushup = made(wger_row(3, "Liegestütze", "Push-up", equipment=["none (bodyweight exercise)"]))
    run_ = made(wger_row(4, "Laufen", "Running", category="Cardio", muscles=[]))

    assert (stretch.kind, stretch.counts) == ("mobility", "time")
    assert (plank.kind, plank.counts) == ("strength", "time")
    assert (pushup.kind, pushup.counts, pushup.equipment) == ("strength", "reps", ())
    assert (run_.kind, run_.counts, run_.muscles_primary) == ("cardio", "time", ())


def test_an_exercise_with_no_german_name_is_left_out() -> None:
    assert from_wger(wger_row(5, None, "Only English"), {}) is None


def test_cues_keep_paragraphs_and_turn_list_items_into_bullets() -> None:
    html = "<p>Erst so.</p>\n<p>Die Schritte:</p><ol><li>Eins</li>\n<li>Zwei</li></ol>"

    assert cues(html) == ("Erst so.", "", "Die Schritte:", "", "- Eins", "- Zwei")


def test_a_name_loses_what_a_wikilink_or_a_file_system_cannot_hold() -> None:
    assert file_name("Liegestütze | erhöht (Incline)") == "Liegestütze - erhöht (Incline)"
    assert file_name("Seilspringen: Grundsprünge") == "Seilspringen - Grundsprünge"
    assert file_name("Armheben (T/Y/I)") == "Armheben (T - Y - I)"
    assert file_name("Curl [neu] #1") == "Curl neu 1"


def test_the_note_carries_its_fields_its_cues_and_an_empty_notes_heading() -> None:
    exercise = from_wger(BENCH, {})
    assert exercise is not None

    text = render(exercise)

    tags = "tags: [übung, kraft, brust, langhantel, bank]"
    assert text.startswith(f"---\ntype: Reference\n{tags}\nkind: strength\n")
    assert "aliases: [Bench Press, Flachbankdrücken]\n" in text
    assert "muscles_primary: [chest]\n" in text
    assert "counts: weight-reps\nsource: wger\n" in text
    assert '\nsource_url: "https://wger.de/de/exercise/192/view/"\n' in text
    assert "# Bankdrücken LH\n\nAuf die Bank legen.\n\n- Absenken\n- Drücken\n" in text
    assert text.endswith("## Meine Notizen\n")


def test_every_mobility_exercise_names_known_muscles_a_test_and_a_count() -> None:
    exercises = mobility()

    assert len({e.name for e in exercises}) == len(exercises)
    for exercise in exercises:
        assert exercise.kind == "mobility"
        assert exercise.counts in COUNTS
        assert exercise.muscles_primary
        assert set(exercise.muscles_primary + exercise.muscles_secondary) <= set(MUSCLES)
        assert exercise.extra["test"] in {f"[[{t}]]" for t in TESTS.values()}
    assert 'test: "[[Knie-zur-Wand]]"' in render(exercises[0])


def test_a_clash_takes_the_english_name_and_the_mobility_programme_goes_first() -> None:
    first = from_wger(BENCH, {})
    second = from_wger(wger_row(9, "Bankdrücken LH", "Barbell Bench Press"), {})
    assert first is not None
    assert second is not None

    names = [name for name, _ in named([first, second])]

    assert names == ["Bankdrücken LH", "Bankdrücken LH (Barbell Bench Press)"]


class Vault:
    """`POST /api/files/{path}` over a dict, and wger and free-exercise-db as two answers."""

    def __init__(self, notes: dict[str, str] | None = None) -> None:
        self.notes = dict(notes or {})
        self.posts = 0

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "wger.de":
            return httpx.Response(200, json={"results": [BENCH], "next": None})
        if str(request.url) == FREE_DB:
            return httpx.Response(200, json=[FREE_BENCH])
        if request.method == "GET":
            return httpx.Response(200, json=sorted(self.notes))
        self.posts += 1
        path = request.url.path.removeprefix("/api/files/")
        if path in self.notes:
            return httpx.Response(409, json={"detail": "exists"})
        self.notes[path] = json.loads(request.content)["content"]
        return httpx.Response(201, json={"path": path})

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handle), base_url="http://kasten")


def test_a_second_run_writes_nothing_and_a_note_there_is_never_overwritten() -> None:
    folder = "03 Areas/11 Fitness/Übungen"
    mine = f"{folder}/Kraft/Brust/Bankdrücken LH.md"
    vault = Vault({mine: "my own words"})
    with vault.client() as client:
        exercises = gather(client)
        api = KastenApi(client)

        assert run(api, folder, exercises, dry_run=False) == 0
        made = dict(vault.notes)
        assert run(api, folder, exercises, dry_run=False) == 0

    assert vault.notes[mine] == "my own words"
    assert len(made) == len(exercises)
    assert vault.notes == made
    assert f"{folder}/Mobilität/Wadendehnung an der Wand.md" in made


def test_a_note_moved_to_another_folder_is_not_made_again() -> None:
    folder = "03 Areas/11 Fitness/Übungen"
    moved = f"{folder}/Kraft/Sonstige/bankdrücken lh.md"
    vault = Vault({moved: "my own words"})
    with vault.client() as client:
        run(KastenApi(client), folder, gather(client), dry_run=False)

    assert not any(p.endswith("/Bankdrücken LH.md") for p in vault.notes)
    assert vault.notes[moved] == "my own words"
