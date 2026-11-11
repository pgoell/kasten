"""The exercises wger has in German, with muscles filled in from free-exercise-db by English name.

wger's data is CC-BY-SA, so each note credits its authors. free-exercise-db is
English only; it adds muscles to the wger exercises it shares a name with.
"""

import re
from html.parser import HTMLParser
from typing import TYPE_CHECKING, Any

from kasten_jobs.exercises.note import Exercise

if TYPE_CHECKING:
    import httpx

WGER = "https://wger.de/api/v2/exerciseinfo/"
FREE_DB = (
    "https://raw.githubusercontent.com/yuhonas/free-exercise-db/"
    "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/dist/exercises.json"
)
GERMAN, ENGLISH = 1, 2

WGER_MUSCLES = {
    1: "biceps",
    2: "front-deltoids",
    3: "obliques",
    4: "chest",
    5: "triceps",
    6: "abs",
    7: "calves",
    8: "gluteal",
    9: "trapezius",
    10: "quadriceps",
    11: "hamstring",
    12: "upper-back",
    13: "biceps",
    14: "obliques",
    15: "calves",
}
"""wger's muscle ids; serratus (3) counts as obliques and brachialis (13) as biceps."""

FREE_DB_MUSCLES = {
    "abdominals": "abs",
    "abductors": "abductors",
    "adductors": "adductor",
    "biceps": "biceps",
    "calves": "calves",
    "chest": "chest",
    "forearms": "forearm",
    "glutes": "gluteal",
    "hamstrings": "hamstring",
    "lats": "upper-back",
    "lower back": "lower-back",
    "middle back": "upper-back",
    "neck": "neck",
    "quadriceps": "quadriceps",
    "shoulders": "front-deltoids",
    "traps": "trapezius",
    "triceps": "triceps",
}

CATEGORY_MUSCLES = {
    "Abs": "abs",
    "Back": "upper-back",
    "Calves": "calves",
    "Chest": "chest",
    "Legs": "quadriceps",
    "Shoulders": "front-deltoids",
}
"""A muscle for an exercise that names none, from its category; Arms and Cardio say too little."""

EQUIPMENT = {
    "Barbell": "Langhantel",
    "Bench": "Bank",
    "Cable machine": "Kabelzug",
    "Dumbbell": "Kurzhantel",
    "Gym mat": "Matte",
    "Incline bench": "Schrägbank",
    "Kettlebell": "Kettlebell",
    "Pull-up bar": "Klimmzugstange",
    "Resistance band": "Widerstandsband",
    "SZ-Bar": "SZ-Stange",
    "Swiss Ball": "Gymnastikball",
}
"""wger's equipment in German; its "none (bodyweight exercise)" is no equipment."""

_HELD = re.compile(r"plank|planke|hold|halten|isometr|unterarmstütz|seitstütz|wall sit", re.I)
_STRETCH = re.compile(r"dehn|stretch", re.I)
_BODY_ONLY = {"Matte", "Klimmzugstange"}


class _Cues(HTMLParser):
    """wger's description HTML as markdown lines: a paragraph each, list items as bullets."""

    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = [""]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag in {"p", "br", "ul", "ol", "h2", "h3", "h4"}:
            self.lines.append("")
        elif tag == "li":
            self.lines.append("- ")

    def handle_data(self, data: str) -> None:
        self.lines[-1] += re.sub(r"\s+", " ", data)


def cues(html: str) -> tuple[str, ...]:
    """The description's text, one markdown line per paragraph or list item."""
    parser = _Cues()
    parser.feed(html)
    kept = [line.strip() for line in parser.lines if line.strip() not in {"", "-"}]
    out: list[str] = []
    for line in kept:
        if out and not (line.startswith("- ") and out[-1].startswith("- ")):
            out.append("")
        out.append(line)
    return tuple(out)


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _ordered(muscles: list[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(muscles))


def fetch_wger(client: httpx.Client) -> list[dict[str, Any]]:
    """Every exercise wger lists, page by page."""
    rows: list[dict[str, Any]] = []
    url: str | None = WGER
    params: dict[str, Any] | None = {"limit": 500, "format": "json"}
    while url:
        page = client.get(url, params=params)
        page.raise_for_status()
        body = page.json()
        rows += body["results"]
        url, params = body.get("next"), None
    return rows


def fetch_free_db(client: httpx.Client) -> dict[str, dict[str, Any]]:
    """free-exercise-db by normalised English name."""
    answer = client.get(FREE_DB)
    answer.raise_for_status()
    return {_norm(row["name"]): row for row in answer.json()}


def _translation(row: dict[str, Any], language: int) -> dict[str, Any] | None:
    return next((t for t in row["translations"] if t["language"] == language), None)


def _counts(kind: str, names: str, equipment: tuple[str, ...]) -> str:
    if kind in {"cardio", "mobility"} or _HELD.search(names):
        return "time"
    if set(equipment) <= _BODY_ONLY:
        return "reps"
    return "weight-reps"


def _video(row: dict[str, Any]) -> str:
    videos = sorted(row.get("videos") or [], key=lambda v: not v.get("is_main"))
    return videos[0]["video"] if videos else ""


def from_wger(row: dict[str, Any], free_db: dict[str, dict[str, Any]]) -> Exercise | None:
    """One wger exercise as a note, or None when it has no German name."""
    german = _translation(row, GERMAN)
    if german is None or not german["name"].strip():
        return None
    english = _translation(row, ENGLISH)
    english_name = english["name"].strip() if english else ""
    match = free_db.get(_norm(english_name)) if english_name else None
    primary = [WGER_MUSCLES[m["id"]] for m in row["muscles"] if m["id"] in WGER_MUSCLES]
    secondary = [WGER_MUSCLES[m["id"]] for m in row["muscles_secondary"] if m["id"] in WGER_MUSCLES]
    if match:
        primary += [FREE_DB_MUSCLES[m] for m in match["primaryMuscles"] if m in FREE_DB_MUSCLES]
        secondary += [FREE_DB_MUSCLES[m] for m in match["secondaryMuscles"] if m in FREE_DB_MUSCLES]
    if not primary and row["category"]["name"] in CATEGORY_MUSCLES:
        primary = [CATEGORY_MUSCLES[row["category"]["name"]]]
    primary_set = _ordered(primary)
    equipment = _ordered([EQUIPMENT.get(e["name"], e["name"]) for e in row["equipment"]])
    equipment = tuple(e for e in equipment if not e.startswith("none"))
    names = f"{german['name']} {english_name}"
    kind = "cardio" if row["category"]["name"] == "Cardio" else "strength"
    if _STRETCH.search(names) or (match and match["category"] == "stretching"):
        kind = "mobility"
    aliases = [english_name, *(a["alias"] for t in (german, english) if t for a in t["aliases"])]
    return Exercise(
        name=german["name"].strip(),
        kind=kind,
        counts=_counts(kind, names, equipment),
        source="wger",
        credit=_credit(row, german, bool(match)),
        aliases=tuple(a for a in _ordered(aliases) if a and a != german["name"].strip()),
        muscles_primary=primary_set,
        muscles_secondary=tuple(m for m in _ordered(secondary) if m not in primary_set),
        equipment=equipment,
        cues=cues(german["description"]),
        video=_video(row),
        extra={
            "source_url": f"https://wger.de/de/exercise/{row['id']}/view/",
            "license": row["license"]["short_name"],
        },
    )


def _credit(row: dict[str, Any], german: dict[str, Any], merged: bool) -> str:
    licence = row["license"]
    authors = ", ".join(dict.fromkeys(a for a in row.get("author_history") or [] if a))
    text_by = ", ".join(dict.fromkeys(a for a in german.get("author_history") or [] if a))
    credit = f"Quelle: [wger](https://wger.de/de/exercise/{row['id']}/view/)"
    if authors:
        credit += f", Übung von {authors}"
    if text_by:
        credit += f", Text von {text_by}"
    credit += f", [{licence['short_name']}]({licence['url']})."
    if merged:
        credit += (
            " Muskeln ergänzt aus [free-exercise-db](https://github.com/yuhonas/free-exercise-db)"
            " (Unlicense)."
        )
    return credit
