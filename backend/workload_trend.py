"""workload-trend-v1 — neutral weekly volume comparison.

Replaces the ACWR readout that used to sit on the analytics screen. It reports
a difference in training volume and nothing else: no risk wording, no
thresholds, no traffic-light colours.

The contract and the rationale live in docs/WORKLOAD_TREND_V1.md. HealthOS
carries an identical copy of that doc and of docs/fixtures/workload-trend-v1.json
(medical/src/lib/workloadTrend.js is the JS twin of this module), and both repos
assert the same fixture hash, so the two implementations cannot drift apart
silently.
"""
from __future__ import annotations

import math
import re
from datetime import date
from typing import Any, Dict, Iterable, List, Optional

WORKLOAD_TREND_VERSION = "workload-trend-v1"

#: Recent window: days 1..7 counting back from the reference date inclusive.
RECENT_DAYS = 7
#: Baseline window: days 8..35 — the four weeks *before* the recent window.
BASELINE_DAYS = 28
BASELINE_WEEKS = BASELINE_DAYS / RECENT_DAYS

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_INSUFFICIENT_TEXT = (
    "Недостаточно данных для сравнения: нужна история за предыдущие четыре недели."
)


def _round_half_away_from_zero(value: float, digits: int = 0) -> float:
    """Half away from zero: -0.5 -> -1, 0.5 -> 1.

    Python's built-in ``round`` is banker's rounding and JavaScript's
    ``Math.round`` breaks ties toward +Infinity; neither matches the other, so
    both sides implement this instead.
    """
    if not math.isfinite(value):
        return 0.0
    factor = 10 ** digits
    scaled = value * factor
    rounded = -math.floor(-scaled + 0.5) if scaled < 0 else math.floor(scaled + 0.5)
    return rounded / factor


def _parse_date(text: str) -> Optional[date]:
    if not _DATE_RE.match(text or ""):
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _plural(n: int, one: str, few: str, many: str) -> str:
    n = abs(int(n))
    mod10, mod100 = n % 10, n % 100
    if mod10 == 1 and mod100 != 11:
        return one
    if 2 <= mod10 <= 4 and not 12 <= mod100 <= 14:
        return few
    return many


def compute_workload_trend(
    sessions: Iterable[Dict[str, Any]], reference_date: str
) -> Dict[str, Any]:
    """Build the workload-trend-v1 payload.

    ``sessions`` is one entry per workout session — two sessions on one date
    stay two entries and are summed.
    """
    result: Dict[str, Any] = {
        "version": WORKLOAD_TREND_VERSION,
        "status": "insufficient",
        "reason": "short-history",
        "recentVolumeKg": 0,
        "baselineVolumeKg": 0,
        "baselineWeeklyVolumeKg": 0,
        "deltaPct": None,
        "recentSessions": 0,
        "baselineSessions": 0,
    }
    reference = _parse_date(str(reference_date or ""))
    if reference is None:
        return result

    recent_volume = 0.0
    baseline_volume = 0.0
    recent_sessions = 0
    baseline_sessions = 0
    oldest_offset: Optional[int] = None  # largest offset seen = earliest session on record

    # Mirrors the JS twin's `Array.isArray` guard: anything that is not a list
    # of rows is treated as no history rather than raising.
    rows = sessions if isinstance(sessions, (list, tuple)) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = _parse_date(str(row.get("date") or ""))
        try:
            volume = float(row.get("volumeKg"))
        except (TypeError, ValueError):
            continue
        # A row only counts when it has a usable date and a positive volume; a
        # zero-volume row is a logging artefact, not a training session.
        if day is None or not math.isfinite(volume) or volume <= 0:
            continue
        offset = (reference - day).days
        if offset < 0:  # future rows are not history
            continue
        if oldest_offset is None or offset > oldest_offset:
            oldest_offset = offset
        if offset < RECENT_DAYS:
            recent_volume += volume
            recent_sessions += 1
        elif offset < RECENT_DAYS + BASELINE_DAYS:
            baseline_volume += volume
            baseline_sessions += 1

    baseline_weekly = baseline_volume / BASELINE_WEEKS
    result.update({
        "status": "ok",
        "reason": None,
        "recentVolumeKg": _round_half_away_from_zero(recent_volume, 1),
        "baselineVolumeKg": _round_half_away_from_zero(baseline_volume, 1),
        "baselineWeeklyVolumeKg": _round_half_away_from_zero(baseline_weekly, 1),
        "recentSessions": recent_sessions,
        "baselineSessions": baseline_sessions,
    })

    # The baseline window must be fully covered by known history, otherwise the
    # divisor is a partial window and the percentage is an artefact of when
    # logging started rather than a change in training.
    if oldest_offset is None or oldest_offset < RECENT_DAYS + BASELINE_DAYS - 1:
        result["status"] = "insufficient"
        result["reason"] = "short-history"
        return result
    if baseline_volume <= 0:
        result["status"] = "insufficient"
        result["reason"] = "no-baseline-volume"
        return result

    result["deltaPct"] = _round_half_away_from_zero(
        ((recent_volume - baseline_weekly) / baseline_weekly) * 100
    )
    return result


def format_workload_trend(trend: Optional[Dict[str, Any]]) -> str:
    """Neutral Russian sentence for a workload-trend-v1 payload. No risk wording."""
    if not trend or trend.get("status") != "ok" or trend.get("deltaPct") is None:
        return _INSUFFICIENT_TEXT
    n = int(trend.get("baselineSessions") or 0)
    tail = f"({n} {_plural(n, 'тренировка', 'тренировки', 'тренировок')} в базовом периоде)"
    delta = trend["deltaPct"]
    if delta == 0:
        return (
            "Объём последних 7 дней совпадает со средним за предыдущие четыре "
            f"недели {tail}."
        )
    direction = "выше" if delta > 0 else "ниже"
    amount = abs(delta)
    amount_text = str(int(amount)) if float(amount).is_integer() else str(amount)
    return (
        f"Объём последних 7 дней на {amount_text}% {direction} среднего за "
        f"предыдущие четыре недели {tail}."
    )


def sets_to_trend_sessions(
    sets: Iterable[Dict[str, Any]],
    session_date_by_id: Dict[str, str],
    volume_of: Any,
) -> List[Dict[str, Any]]:
    """Adapter: gym_sets rows -> workload-trend-v1 input, one entry per session.

    ``volume_of(row)`` returns the tonnage contribution of a single set, so the
    caller keeps ownership of what counts as volume.
    """
    totals: Dict[str, float] = {}
    for row in sets or []:
        session_id = str(row.get("session_id") or "")
        if not session_id or session_id not in session_date_by_id:
            continue
        totals[session_id] = totals.get(session_id, 0.0) + float(volume_of(row))
    return [
        {"date": str(session_date_by_id[session_id]), "volumeKg": volume}
        for session_id, volume in totals.items()
    ]
