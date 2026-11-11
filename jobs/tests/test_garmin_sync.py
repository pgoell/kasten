"""The Garmin sync on made-up activity rows, against fakes of Garmin and kasten."""

import json
from datetime import date
from typing import TYPE_CHECKING, Any

import httpx
import pytest

from kasten_jobs.garmin import Settings, activity_of, line_of, run
from kasten_jobs.garmin.garmin_api import GarminApi, GarminError, token_of
from kasten_jobs.kasten_api import KastenApi

if TYPE_CHECKING:
    from pathlib import Path

TODAY = date(2026, 11, 11)


def row(activity_id: int, type_key: str, start: str, seconds: float, **more: Any) -> dict[str, Any]:
    return {
        "activityId": activity_id,
        "activityType": {"typeKey": type_key},
        "startTimeLocal": start,
        "duration": seconds,
        **more,
    }


RIDE = row(11, "road_biking", "2026-11-11 07:40:12", 1324.5, distance=7412.0, averageHR=131.4)
RUN = row(12, "trail_running", "2026-11-10 18:02:00", 1920, distance=5000.0)
SWIM = row(13, "lap_swimming", "2026-11-10 12:00:00", 1800, distance=1500.0)
WALK = row(14, "walking", "2026-11-10 08:00:00", 2100, distance=2900.0, averageHR=98)


class Fakes:
    """Garmin's token and list routes, and kasten's training read and write."""

    def __init__(self, rows: list[dict[str, Any]], days: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.days = days
        self.posted: dict[str, list[str]] = {}
        self.auth: list[str] = []

    def garmin(self, request: httpx.Request) -> httpx.Response:
        self.auth.append(request.headers["Authorization"])
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "t0k", "expires_in": 3600})
        start = int(request.url.params["start"])
        return httpx.Response(200, json=self.rows[start : start + 99])

    def kasten(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json=self.days)
        day = request.url.path.rsplit("/", 1)[1]
        lines = json.loads(request.content)["lines"]
        self.posted.setdefault(day, []).extend(lines)
        return httpx.Response(200, json={"path": f"x/{day}.md", "added": lines})

    def apis(self) -> tuple[GarminApi, KastenApi]:
        garmin = httpx.Client(base_url="https://g", transport=httpx.MockTransport(self.garmin))
        kasten = httpx.Client(base_url="http://k", transport=httpx.MockTransport(self.kasten))
        return GarminApi(garmin, "k3y"), KastenApi(kasten)


def settings(tmp_path: Path) -> Settings:
    return Settings.from_env({"GARMIN_API_KEY": "k3y", "GARMIN_STATE": str(tmp_path / "s.json")})


def test_1720_an_activity_reads_as_its_line() -> None:
    ride = activity_of(RIDE)
    assert ride is not None
    assert line_of(ride) == "- 🚲 [[Radfahren]] 22 min 7.4 km ❤ 131"
    run_line = activity_of(RUN)
    assert run_line is not None
    assert line_of(run_line) == "- 🏃 [[Joggen]] 32 min 5 km"
    assert activity_of(SWIM) is None
    assert activity_of(row(15, "walking", "2026-11-10 08:00:00", 0)) is None


def test_1720_writes_each_new_walk_run_and_ride_once(tmp_path: Path) -> None:
    fakes = Fakes([RUN, SWIM, WALK, RIDE], [])
    garmin, kasten = fakes.apis()

    assert run(garmin, kasten, settings(tmp_path), TODAY) == 0
    assert fakes.posted == {
        "2026-11-10": ["- 🏃 [[Joggen]] 32 min 5 km", "- 🚶 [[Gehen]] 35 min 2.9 km ❤ 98"],
        "2026-11-11": ["- 🚲 [[Radfahren]] 22 min 7.4 km ❤ 131"],
    }
    assert fakes.auth[:2] == ["ApiKey k3y", "Bearer t0k"]

    # A second run, after the walk's line was deleted by hand, writes nothing again.
    fakes.posted = {}
    run(*fakes.apis(), settings(tmp_path), TODAY)
    assert fakes.posted == {}


def test_1720_leaves_out_what_a_typed_line_already_holds(tmp_path: Path) -> None:
    typed = {"date": "2026-11-11", "entries": [{"kind": "ride", "minutes": 20}]}
    fakes = Fakes([RIDE], [typed])

    run(*fakes.apis(), settings(tmp_path), TODAY)

    assert fakes.posted == {}
    assert json.loads((tmp_path / "s.json").read_text())["written"] == [11]


def test_1720_its_own_line_is_no_typed_line_for_a_second_ride(tmp_path: Path) -> None:
    home = row(16, "road_biking", "2026-11-11 18:00:00", 1380, distance=7300.0)
    fakes = Fakes([RIDE], [])
    run(*fakes.apis(), settings(tmp_path), TODAY)

    # The next run reads the morning's line back, and a ride home of about the same length.
    morning = {"kind": "ride", "minutes": 22}
    fakes = Fakes([RIDE, home], [{"date": "2026-11-11", "entries": [morning]}])
    run(*fakes.apis(), settings(tmp_path), TODAY)

    assert fakes.posted == {"2026-11-11": ["- 🚲 [[Radfahren]] 23 min 7.3 km"]}


def test_1720_one_typed_line_stands_for_one_activity(tmp_path: Path) -> None:
    again = row(17, "road_biking", "2026-11-11 18:00:00", 1324.5, distance=7412.0, averageHR=131.4)
    typed = {"date": "2026-11-11", "entries": [{"kind": "ride", "minutes": 22}]}
    fakes = Fakes([RIDE, again], [typed])

    run(*fakes.apis(), settings(tmp_path), TODAY)

    assert fakes.posted == {"2026-11-11": ["- 🚲 [[Radfahren]] 22 min 7.4 km ❤ 131"]}


def test_1720_a_dry_run_prints_and_keeps_no_state(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    fakes = Fakes([RIDE], [])

    run(*fakes.apis(), settings(tmp_path), TODAY, dry_run=True)

    assert capsys.readouterr().out == "2026-11-11 - 🚲 [[Radfahren]] 22 min 7.4 km ❤ 131\n"
    assert fakes.posted == {}
    assert not (tmp_path / "s.json").exists()


def test_1720_the_token_answer_never_reaches_the_log() -> None:
    assert token_of({"accessToken": "a"}) == "a"
    with pytest.raises(GarminError, match=r"\['secret_thing'\]") as raised:
        token_of({"secret_thing": "hunter2"})
    assert "hunter2" not in str(raised.value)


def test_1720_a_typed_line_stands_for_one_activity_on_later_runs_too(tmp_path: Path) -> None:
    home = row(18, "road_biking", "2026-11-11 18:00:00", 1380, distance=7300.0)
    typed = {"date": "2026-11-11", "entries": [{"kind": "ride", "minutes": 22}]}
    fakes = Fakes([RIDE], [typed])
    run(*fakes.apis(), settings(tmp_path), TODAY)
    assert fakes.posted == {}

    fakes = Fakes([RIDE, home], [typed])
    run(*fakes.apis(), settings(tmp_path), TODAY)

    assert fakes.posted == {"2026-11-11": ["- 🚲 [[Radfahren]] 23 min 7.3 km"]}
