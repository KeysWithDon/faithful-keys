"""Apply a performance rhythm grid to an authoritative Faithful Keys chart.

The uploaded chart is the only source of chord identity, quality, extensions,
slash basses, spelling, and section order. Audio/video contributes only tempo
and event timing. No detected pitch or chord candidate crosses this boundary.
"""

from __future__ import annotations

import re
from typing import Any


_PITCH_CLASSES = {
    "C": 0, "B♯": 0, "C♯": 1, "D♭": 1, "D": 2, "D♯": 3,
    "E♭": 3, "E": 4, "F♭": 4, "E♯": 5, "F": 5, "F♯": 6,
    "G♭": 6, "G": 7, "G♯": 8, "A♭": 8, "A": 9, "A♯": 10,
    "B♭": 10, "B": 11, "C♭": 11,
}


def _finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
        return number if number == number and abs(number) != float("inf") else fallback
    except (TypeError, ValueError):
        return fallback


def _parse(symbol: Any) -> tuple[int | None, str, str | None]:
    """Normalize a temporary comparison copy without rewriting chart text."""
    value = str(symbol or "").strip().replace("#", "♯").replace("b", "♭")
    main, slash = (value.rsplit("/", 1) + [None])[:2] if "/" in value else (value, None)
    match = re.match(r"^([A-G](?:[♯♭])?)(.*)$", main)
    if not match:
        return None, "", slash
    root, suffix = match.groups()
    return _PITCH_CLASSES.get(root), suffix.lower(), slash


def _quality_family(suffix: str) -> str:
    if "m7♭5" in suffix or "ø" in suffix:
        return "half-diminished"
    if "dim" in suffix or "°" in suffix:
        return "diminished"
    if suffix.startswith("m") and not suffix.startswith("maj"):
        return "minor"
    if "sus" in suffix:
        return "suspended"
    if "aug" in suffix or "+" in suffix:
        return "augmented"
    return "major"


def chord_distance(chart_chord: str, comparison_chord: str) -> float:
    """Pitch-only comparison utility retained for diagnostics and tests."""
    chart_root, chart_suffix, _ = _parse(chart_chord)
    comparison_root, comparison_suffix, _ = _parse(comparison_chord)
    if chart_root is None or comparison_root is None:
        return 1.0
    if chart_root == comparison_root and _quality_family(chart_suffix) == _quality_family(comparison_suffix):
        return 0.0 if chart_suffix == comparison_suffix else 0.08
    if chart_root == comparison_root:
        return 0.25
    root_distance = min((chart_root - comparison_root) % 12, (comparison_root - chart_root) % 12)
    return min(1.0, 0.68 + root_distance * 0.045)


def flatten_reference_chart(chart: dict[str, Any]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    absolute_beat_cursor = 0
    for section_index, section in enumerate(chart.get("sections") or []):
        if not isinstance(section, dict):
            continue
        for measure_index, measure in enumerate(section.get("measures") or []):
            if not isinstance(measure, dict):
                continue
            measure_beats = max(1, int(measure.get("beats") or 4))
            for event in measure.get("chordEvents") or []:
                if not isinstance(event, dict):
                    continue
                symbol = str(event.get("chartChord") or event.get("chordSymbol") or "").strip()
                if not symbol or symbol == "?":
                    continue
                beat = max(1, min(measure_beats, int(event.get("beat") or 1)))
                output.append({
                    "eventId": str(event.get("id") or f"chart-{len(output) + 1}"),
                    "chartChord": symbol,
                    "section": str(section.get("name") or f"Section {section_index + 1}"),
                    "sectionIndex": section_index,
                    "measure": int(event.get("measureNumber") or measure.get("number") or measure_index + 1),
                    "measureIndex": measure_index,
                    "beat": beat,
                    "absoluteBeat": absolute_beat_cursor + beat - 1,
                    "measureEndBeat": absolute_beat_cursor + measure_beats,
                    "locked": bool(event.get("locked")),
                })
            absolute_beat_cursor += measure_beats
    return output


def _time_for_beat(beat_times: list[float], beat_index: int, bpm: float) -> float:
    seconds_per_beat = 60.0 / max(30.0, min(200.0, _finite(bpm, 72.0)))
    beats = [_finite(value) for value in beat_times]
    if not beats:
        return beat_index * seconds_per_beat
    if beat_index < len(beats):
        return beats[beat_index]
    return beats[-1] + (beat_index - len(beats) + 1) * seconds_per_beat


def align_chart_to_audio(
    reference_chart: dict[str, Any],
    audio_events: list[dict[str, Any]],
    beat_times: list[float],
    bpm: float,
) -> list[dict[str, Any]]:
    """Attach only rhythmic timestamps to the uploaded chart.

    The audio_events parameter is deliberately ignored. It remains for API
    compatibility with older workers, but detected chords, notes, basses,
    voicings, extensions, and passing harmonies can never enter the chart.
    """
    del audio_events
    reference = flatten_reference_chart(reference_chart)
    if not reference:
        raise ValueError("A chart-first analysis requires at least one chart chord.")
    has_detected_grid = bool(beat_times)
    timing_confidence = .95 if has_detected_grid else .65
    output: list[dict[str, Any]] = []
    for index, item in enumerate(reference):
        start_beat = int(item["absoluteBeat"])
        next_beat = int(reference[index + 1]["absoluteBeat"]) if index + 1 < len(reference) else int(item["measureEndBeat"])
        end_beat = max(start_beat + 1, next_beat)
        start = _time_for_beat(beat_times, start_beat, bpm)
        end = max(start, _time_for_beat(beat_times, end_beat, bpm))
        reason = "The uploaded chart supplied this chord; the performance supplied only its rhythmic start and duration."
        output.append({
            "eventId": item["eventId"],
            "referenceEventId": item["eventId"],
            "chartAuthority": True,
            "timingOnly": True,
            "chartChord": item["chartChord"],
            "originalChord": item["chartChord"],
            "chordSymbol": item["chartChord"],
            "locked": item["locked"],
            "section": item["section"],
            "sectionIndex": item["sectionIndex"],
            "measure": item["measure"],
            "measureIndex": item["measureIndex"],
            "beat": item["beat"],
            "startTime": round(start, 4),
            "endTime": round(end, 4),
            "confidenceScore": timing_confidence,
            "timingConfidence": timing_confidence,
            "selectionReason": reason,
            "needsUserReview": False,
            "alternateCandidates": [],
            "candidateScores": [{"chord": item["chartChord"], "score": 1.0}],
            "review": {
                "eventId": item["eventId"],
                "originalChord": item["chartChord"],
                "recommendedChord": item["chartChord"],
                "status": "Confirmed" if has_detected_grid else "Likely",
                "confidence": timing_confidence,
                "reason": reason,
                "alternatives": [],
                "candidateRanking": [item["chartChord"]],
                "needsHumanReview": False,
            },
        })
    return output
