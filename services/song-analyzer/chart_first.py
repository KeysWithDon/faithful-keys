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
                beat = round(_finite(event.get("beat"), 1.0) * 2) / 2
                beat = max(1.0, min(measure_beats + .5, beat))
                output.append({
                    "eventId": str(event.get("id") or f"chart-{len(output) + 1}"),
                    "chartChord": symbol,
                    "section": str(section.get("name") or f"Section {section_index + 1}"),
                    "sectionIndex": section_index,
                    "measure": int(event.get("measureNumber") or measure.get("number") or measure_index + 1),
                    "measureIndex": measure_index,
                    "beat": beat,
                    "absoluteBeat": absolute_beat_cursor + beat - 1,
                    "measureStartBeat": absolute_beat_cursor,
                    "measureEndBeat": absolute_beat_cursor + measure_beats,
                    "locked": bool(event.get("locked")),
                })
            absolute_beat_cursor += measure_beats
    return output


def _swing_beat_position(position: float, swing_percent: Any) -> float:
    swing = max(50.0, min(75.0, _finite(swing_percent, 50.0))) / 100.0
    whole = int(position // 1)
    fraction = position - whole
    if fraction <= .5:
        return whole + fraction * 2 * swing
    return whole + swing + (fraction - .5) * 2 * (1 - swing)


def _time_for_beat(beat_times: list[float], beat_position: float, bpm: float, swing_percent: Any = 50) -> float:
    seconds_per_beat = 60.0 / max(10.0, min(250.0, _finite(bpm, 72.0)))
    beats = [_finite(value) for value in beat_times]
    position = _swing_beat_position(beat_position, swing_percent)
    if not beats:
        return position * seconds_per_beat
    lower = int(position // 1)
    fraction = position - lower
    if lower + 1 < len(beats):
        return beats[lower] + (beats[lower + 1] - beats[lower]) * fraction
    return beats[-1] + (position - len(beats) + 1) * seconds_per_beat


def _rhythm_map(rhythm_events: list[dict[str, Any]]) -> dict[int, dict[str, float]]:
    """Index worker rhythm evidence without accepting any harmonic fields."""
    indexed: dict[int, dict[str, float]] = {}
    for event in rhythm_events:
        if not isinstance(event, dict) or "halfBeatIndex" not in event:
            continue
        try:
            index = max(0, int(event["halfBeatIndex"]))
        except (TypeError, ValueError):
            continue
        indexed[index] = {
            "onsetStrength": max(0.0, min(1.0, _finite(event.get("onsetStrength")))),
            "activity": max(0.0, min(1.0, _finite(event.get("activity")))),
            "releaseStrength": max(0.0, min(1.0, _finite(event.get("releaseStrength")))),
        }
    return indexed


def _align_measure_slots(items: list[dict[str, Any]], evidence: dict[int, dict[str, float]]) -> list[int]:
    """Find an ordered set of beat/“&” slots near the chart's placements.

    The search is deliberately bar-local and never reorders or drops a chart
    chord. Strong accompaniment changes may move a chord at most 1.5 beats;
    weak or absent evidence keeps the chart placement exactly as entered.
    """
    if not items:
        return []
    expected = [int(round(float(item["absoluteBeat"]) * 2)) for item in items]
    if not evidence:
        return expected
    measure_start = int(round(float(items[0]["measureStartBeat"]) * 2))
    measure_end = int(round(float(items[0]["measureEndBeat"]) * 2)) - 1
    states: dict[int, tuple[float, list[int]]] = {}
    for event_index, expected_slot in enumerate(expected):
        remaining = len(items) - event_index - 1
        minimum = max(measure_start + event_index, expected_slot - 3)
        maximum = min(measure_end - remaining, expected_slot + 3)
        candidates = list(range(minimum, maximum + 1))
        if expected_slot not in candidates and measure_start <= expected_slot <= measure_end:
            candidates.append(expected_slot)
            candidates.sort()
        next_states: dict[int, tuple[float, list[int]]] = {}
        for slot in candidates:
            rhythm = evidence.get(slot, {})
            onset = rhythm.get("onsetStrength", 0.0)
            distance = abs(slot - expected_slot)
            placement_score = onset * 1.55 - distance * .18
            if distance and onset < .32:
                placement_score -= .55
            if event_index == 0 and expected_slot == measure_start:
                placement_score -= distance * .10
            if event_index == 0:
                candidate = (placement_score, [slot])
            else:
                previous = [value for previous_slot, value in states.items() if previous_slot < slot]
                if not previous:
                    continue
                best_previous = max(previous, key=lambda value: value[0])
                candidate = (best_previous[0] + placement_score, [*best_previous[1], slot])
            if slot not in next_states or candidate[0] > next_states[slot][0]:
                next_states[slot] = candidate
        states = next_states
    if not states:
        return expected
    return max(states.values(), key=lambda value: value[0])[1]


def _aligned_reference_slots(reference: list[dict[str, Any]], evidence: dict[int, dict[str, float]]) -> list[int]:
    slots = [int(round(float(item["absoluteBeat"]) * 2)) for item in reference]
    groups: dict[tuple[int, int], list[int]] = {}
    for index, item in enumerate(reference):
        groups.setdefault((int(item["sectionIndex"]), int(item["measureIndex"])), []).append(index)
    for indices in groups.values():
        aligned = _align_measure_slots([reference[index] for index in indices], evidence)
        for index, slot in zip(indices, aligned):
            slots[index] = slot
    return slots


def align_chart_to_audio(
    reference_chart: dict[str, Any],
    audio_events: list[dict[str, Any]],
    beat_times: list[float],
    bpm: float,
) -> list[dict[str, Any]]:
    """Attach rhythm-only starts, releases, holds, and phrase boundaries.

    ``audio_events`` may contain only indexed onset/activity measurements. Any
    chord, pitch, note, bass, extension, or candidate fields are ignored. The
    uploaded chart remains the sole source of harmony and order.
    """
    reference = flatten_reference_chart(reference_chart)
    if not reference:
        raise ValueError("A chart-first analysis requires at least one chart chord.")
    has_detected_grid = bool(beat_times)
    timing_confidence = .95 if has_detected_grid else .65
    swing_percent = max(50.0, min(75.0, _finite(reference_chart.get("swingPercent"), 50.0)))
    rhythm = _rhythm_map(audio_events)
    aligned_slots = _aligned_reference_slots(reference, rhythm)
    output: list[dict[str, Any]] = []
    for index, item in enumerate(reference):
        start_slot = aligned_slots[index]
        next_slot = aligned_slots[index + 1] if index + 1 < len(reference) else int(round(float(item["measureEndBeat"]) * 2))
        nominal_end_slot = max(start_slot + 1, next_slot)
        end_slot = nominal_end_slot
        release_style = "connected"
        # A clearly measured drop in harmonic activity is allowed to shorten a
        # chord, but never below an eighth-note duration.
        for boundary in range(start_slot + 1, nominal_end_slot):
            previous_activity = rhythm.get(boundary - 1, {}).get("activity", 0.0)
            following_activity = rhythm.get(boundary, {}).get("activity", 0.0)
            release = rhythm.get(boundary, {}).get("releaseStrength", 0.0)
            if release >= .58 and previous_activity >= .28 and following_activity <= .22:
                end_slot = boundary
                release_style = "detached"
                break
        start_beat = start_slot / 2
        end_beat = end_slot / 2
        start = _time_for_beat(beat_times, start_beat, bpm, swing_percent)
        end = max(start, _time_for_beat(beat_times, end_beat, bpm, swing_percent))
        expected_slot = int(round(float(item["absoluteBeat"]) * 2))
        onset_strength = rhythm.get(start_slot, {}).get("onsetStrength", 0.0)
        if rhythm:
            timing_confidence = max(.62, min(.96, .68 + onset_strength * .25 - abs(start_slot - expected_slot) * .015))
        measure_end_slot = int(round(float(item["measureEndBeat"]) * 2))
        next_item = reference[index + 1] if index + 1 < len(reference) else None
        same_chord_tie = bool(
            next_item
            and str(next_item["chartChord"]) == str(item["chartChord"])
            and aligned_slots[index + 1] == measure_end_slot
            and rhythm.get(measure_end_slot, {}).get("onsetStrength", 0.0) < .28
            and rhythm.get(measure_end_slot - 1, {}).get("activity", 0.0) >= .24
        )
        sustain_across_bar = end_slot > measure_end_slot or same_chord_tie
        if sustain_across_bar:
            release_style = "held"
        phrase_boundary = release_style == "detached" or bool(next_item and next_item["sectionIndex"] != item["sectionIndex"])
        moved = start_slot != expected_slot
        reason = (
            f"The chart chord stayed unchanged; performance phrasing placed it on beat "
            f"{(start_slot - int(round(float(item['measureStartBeat']) * 2))) / 2 + 1:g}"
            f"{' and found a natural release' if release_style == 'detached' else ' with a connected sustain'}."
            if rhythm else
            "The uploaded chart supplied this chord; the fixed tempo grid supplied its start and duration."
        )
        output.append({
            "eventId": item["eventId"],
            "referenceEventId": item["eventId"],
            "chartAuthority": True,
            "timingOnly": True,
            "rhythmVersion": 2,
            "chartChord": item["chartChord"],
            "originalChord": item["chartChord"],
            "chordSymbol": item["chartChord"],
            "locked": item["locked"],
            "section": item["section"],
            "sectionIndex": item["sectionIndex"],
            "measure": item["measure"],
            "measureIndex": item["measureIndex"],
            "beat": (start_slot - int(round(float(item["measureStartBeat"]) * 2))) / 2 + 1,
            "startTime": round(start, 4),
            "endTime": round(end, 4),
            "confidenceScore": round(timing_confidence, 3),
            "timingConfidence": round(timing_confidence, 3),
            "rhythmStrength": round(onset_strength, 3),
            "releaseStyle": release_style,
            "phraseBoundary": phrase_boundary,
            "sustainAcrossBar": sustain_across_bar,
            "timingAdjusted": moved or release_style != "connected",
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
