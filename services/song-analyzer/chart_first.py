"""Chart-first alignment for Faithful Keys.

The uploaded chart owns chord identity and section order. Audio events may add
timing and evidence, but they cannot silently rewrite the chart. Unmatched,
strong audio events are returned only as confirmation-required passing-chord
suggestions.
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


def chord_distance(chart_chord: str, audio_chord: str) -> float:
    chart_root, chart_suffix, _ = _parse(chart_chord)
    audio_root, audio_suffix, _ = _parse(audio_chord)
    if chart_root is None or audio_root is None:
        return 1.0
    if chart_root == audio_root and _quality_family(chart_suffix) == _quality_family(audio_suffix):
        return 0.0 if chart_suffix == audio_suffix else 0.08
    if chart_root == audio_root:
        return 0.25
    root_distance = min((chart_root - audio_root) % 12, (audio_root - chart_root) % 12)
    return min(1.0, 0.68 + root_distance * 0.045)


def flatten_reference_chart(chart: dict[str, Any]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for section_index, section in enumerate(chart.get("sections") or []):
        if not isinstance(section, dict):
            continue
        for measure_index, measure in enumerate(section.get("measures") or []):
            if not isinstance(measure, dict):
                continue
            for event in measure.get("chordEvents") or []:
                if not isinstance(event, dict):
                    continue
                symbol = str(event.get("chartChord") or event.get("chordSymbol") or "").strip()
                if not symbol or symbol == "?":
                    continue
                output.append({
                    "eventId": str(event.get("id") or f"chart-{len(output) + 1}"),
                    "chartChord": symbol,
                    "section": str(section.get("name") or f"Section {section_index + 1}"),
                    "sectionIndex": section_index,
                    "measure": int(event.get("measureNumber") or measure.get("number") or measure_index + 1),
                    "measureIndex": measure_index,
                    "beat": int(event.get("beat") or 1),
                    "locked": bool(event.get("locked")),
                })
    return output


def _sequence_alignment(reference: list[dict[str, Any]], audio: list[dict[str, Any]]) -> tuple[dict[int, int], list[int]]:
    """Needleman-Wunsch alignment that preserves both progressions' order."""
    n, m = len(reference), len(audio)
    infinity = float("inf")
    costs = [[infinity] * (m + 1) for _ in range(n + 1)]
    trace: list[list[tuple[int, int, str] | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    costs[0][0] = 0.0
    for index in range(1, n + 1):
        costs[index][0] = costs[index - 1][0] + 0.72
        trace[index][0] = (index - 1, 0, "skip-chart")
    for index in range(1, m + 1):
        costs[0][index] = costs[0][index - 1] + 0.34
        trace[0][index] = (0, index - 1, "skip-audio")
    for chart_index in range(1, n + 1):
        for audio_index in range(1, m + 1):
            progress_cost = abs((chart_index - .5) / max(1, n) - (audio_index - .5) / max(1, m)) * .18
            options = [
                (costs[chart_index - 1][audio_index - 1] + chord_distance(
                    reference[chart_index - 1]["chartChord"], str(audio[audio_index - 1].get("chordSymbol") or "?"),
                ) + progress_cost, chart_index - 1, audio_index - 1, "match"),
                (costs[chart_index][audio_index - 1] + .34, chart_index, audio_index - 1, "skip-audio"),
                (costs[chart_index - 1][audio_index] + .72, chart_index - 1, audio_index, "skip-chart"),
            ]
            cost, previous_chart, previous_audio, action = min(options, key=lambda item: item[0])
            costs[chart_index][audio_index] = cost
            trace[chart_index][audio_index] = (previous_chart, previous_audio, action)
    matches: dict[int, int] = {}
    skipped_audio: list[int] = []
    chart_index, audio_index = n, m
    while chart_index or audio_index:
        step = trace[chart_index][audio_index]
        if step is None:
            break
        previous_chart, previous_audio, action = step
        if action == "match":
            matches[chart_index - 1] = audio_index - 1
        elif action == "skip-audio":
            skipped_audio.append(audio_index - 1)
        chart_index, audio_index = previous_chart, previous_audio
    return matches, sorted(skipped_audio)


def _nearest_beat(beats: list[float], timestamp: float) -> tuple[int, float]:
    if not beats:
        return 0, timestamp
    index = min(range(len(beats)), key=lambda candidate: abs(beats[candidate] - timestamp))
    return index, beats[index]


def _possible_extension(chart_chord: str, audio_chord: str) -> str | None:
    chart_root, chart_suffix, _ = _parse(chart_chord)
    audio_root, audio_suffix, _ = _parse(audio_chord)
    if chart_root is None or chart_root != audio_root or _quality_family(chart_suffix) != _quality_family(audio_suffix):
        return None
    if chart_chord == audio_chord:
        return None
    chart_rank = max((int(value) for value in re.findall(r"(?:7|9|11|13)", chart_suffix)), default=0)
    audio_rank = max((int(value) for value in re.findall(r"(?:7|9|11|13)", audio_suffix)), default=0)
    return audio_chord if audio_rank > chart_rank else None


def align_chart_to_audio(
    reference_chart: dict[str, Any],
    audio_events: list[dict[str, Any]],
    beat_times: list[float],
    bpm: float,
) -> list[dict[str, Any]]:
    reference = flatten_reference_chart(reference_chart)
    if not reference:
        raise ValueError("A chart-first analysis requires at least one chart chord.")
    audio = sorted((dict(event) for event in audio_events), key=lambda event: _finite(event.get("startTime")))
    matches, skipped_audio = _sequence_alignment(reference, audio)
    duration = max([_finite(event.get("endTime")) for event in audio] + beat_times + [len(reference) * 60.0 / max(30.0, bpm)])
    seconds_per_slot = duration / max(1, len(reference))
    output: list[dict[str, Any]] = []

    for index, item in enumerate(reference):
        matched = audio[matches[index]] if index in matches else None
        guessed_start = index * seconds_per_slot
        guessed_end = (index + 1) * seconds_per_slot
        if matched:
            start = max(0.0, _finite(matched.get("startTime"), guessed_start))
            end = max(start, _finite(matched.get("endTime"), guessed_end))
            audio_chord = str(matched.get("chordSymbol") or "?")
            agreement = max(0.0, min(1.0, 1.0 - chord_distance(item["chartChord"], audio_chord)))
            audio_confidence = max(0.0, min(1.0, _finite(matched.get("confidenceScore"), .5)))
            possible_extension = _possible_extension(item["chartChord"], audio_chord)
            alternatives = list(dict.fromkeys([
                candidate for candidate in [audio_chord, *(matched.get("alternateCandidates") or [])]
                if isinstance(candidate, str) and candidate not in {"?", item["chartChord"]}
            ]))[:5]
            conflict = audio_chord if agreement < .55 else None
            if agreement >= .82:
                status, reason, needs_review = "Confirmed", "The chart chord is supported by the accompaniment and aligned audio timing.", False
            elif agreement >= .58:
                status, reason, needs_review = "Likely", "The chart chord remains the harmonic reference; audio differences are consistent with voicing or ornamentation.", False
            else:
                status, reason, needs_review = "Ambiguous", f"The chart keeps {item['chartChord']}, while the audio detector also heard {audio_chord}; review this segment before changing it.", True
            if item["locked"]:
                reason = f"Locked chart chord {item['chartChord']} was preserved. " + reason
        else:
            start, end = guessed_start, guessed_end
            audio_chord, agreement, audio_confidence = "?", 0.0, 0.0
            possible_extension, alternatives, conflict = None, [], None
            status, reason, needs_review = "Unknown", "No reliable audio segment aligned here, so the chart chord was preserved.", True
        beat_index, snapped = _nearest_beat(beat_times, start)
        end_beat_index, snapped_end = _nearest_beat(beat_times, end)
        if snapped_end <= snapped:
            snapped_end = end
        upper_notes = list(matched.get("detectedNotes") or []) if matched else []
        accompaniment = list(matched.get("accompanimentNotes") or upper_notes) if matched else []
        melody = list(matched.get("melodyNotes") or []) if matched else []
        ranking = [item["chartChord"], *alternatives]
        output.append({
            **(matched or {}),
            "eventId": item["eventId"],
            "referenceEventId": item["eventId"],
            "chartAuthority": True,
            "chartChord": item["chartChord"],
            "originalChord": item["chartChord"],
            "chordSymbol": item["chartChord"],
            "locked": item["locked"],
            "section": item["section"],
            "sectionIndex": item["sectionIndex"],
            "measure": item["measure"],
            "measureIndex": item["measureIndex"],
            "beat": item["beat"],
            "startTime": round(snapped, 4),
            "endTime": round(max(snapped, snapped_end), 4),
            "audioDetectedChord": audio_chord if audio_chord != "?" else None,
            "confidenceScore": round(audio_confidence, 3),
            "audioConfidence": round(audio_confidence, 3),
            "chartAudioAgreement": round(agreement, 3),
            "detectedVoicing": accompaniment,
            "detectedNotes": accompaniment,
            "accompanimentNotes": accompaniment,
            "melodyNotes": melody,
            "possibleExtension": possible_extension,
            "extensionDecision": "pending" if possible_extension else None,
            "conflictingAudioInterpretation": conflict,
            "selectionReason": reason,
            "needsUserReview": needs_review or bool(possible_extension),
            "alternateCandidates": alternatives,
            "candidateScores": [{"chord": item["chartChord"], "score": round(agreement, 3)}, *[
                entry for entry in (matched.get("candidateScores") or [])
                if isinstance(entry, dict) and entry.get("chord") in alternatives
            ]],
            "review": {
                "eventId": item["eventId"], "originalChord": item["chartChord"],
                "recommendedChord": item["chartChord"], "status": status,
                "confidence": round(max(audio_confidence, agreement), 3), "reason": reason,
                "alternatives": alternatives, "candidateRanking": ranking,
                "needsHumanReview": needs_review,
            },
            "_matchedAudioIndex": matches.get(index),
            "_absoluteBeat": beat_index,
            "_endAbsoluteBeat": end_beat_index,
        })

    # Strong unmatched harmony is a suggestion only. Attach it to the preceding
    # chart event so the UI can accept or reject it explicitly.
    for audio_index in skipped_audio:
        event = audio[audio_index]
        confidence = _finite(event.get("confidenceScore"), .5)
        start, end = _finite(event.get("startTime")), _finite(event.get("endTime"))
        chord = str(event.get("chordSymbol") or "?")
        if chord == "?" or confidence < .72 or end - start < .6:
            continue
        previous = [item for item in output if item["startTime"] <= start]
        target = previous[-1] if previous else output[0]
        next_items = [item for item in output if item["startTime"] > start]
        if chord_distance(chord, target["chartChord"]) <= .08 or (next_items and chord_distance(chord, next_items[0]["chartChord"]) <= .08):
            continue
        beat_index, _ = _nearest_beat(beat_times, start)
        target["passingChordSuggestion"] = {
            "chordSymbol": chord, "startTime": round(start, 4), "endTime": round(end, 4),
            "beat": beat_index % max(1, int(str(reference_chart.get("timeSignature") or "4/4").split("/")[0])) + 1,
            "confidence": round(confidence, 3),
            "reason": "Sustained multi-note audio and bass movement suggest harmony between two chart chords; confirmation is required.",
            "decision": "pending",
        }
        target["needsUserReview"] = True

    for item in output:
        item.pop("_matchedAudioIndex", None)
        item.pop("_absoluteBeat", None)
        item.pop("_endAbsoluteBeat", None)
    return output

