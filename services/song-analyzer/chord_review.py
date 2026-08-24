"""Constrained, post-recognition review for completed chord charts.

The recognizer and spectral pass remain authoritative sources of candidates.
This module may rank those candidates, but it never creates a chord symbol.
Any unavailable, invalid, or unsupported model response returns the completed
deterministic chart unchanged.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Iterable

import httpx


REVIEW_STATUSES = {"Confirmed", "Likely", "Ambiguous", "Unknown"}
MAX_REVIEW_BATCH = 40
LOCAL_REVIEW_MODEL = "local-evidence-v1"

_PITCH_CLASSES = {
    "C": 0, "B♯": 0, "C♯": 1, "D♭": 1, "D": 2, "D♯": 3,
    "E♭": 3, "E": 4, "F♭": 4, "E♯": 5, "F": 5, "F♯": 6,
    "G♭": 6, "G": 7, "G♯": 8, "A♭": 8, "A": 9, "A♯": 10,
    "B♭": 10, "B": 11, "C♭": 11,
}

REVIEW_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "reviews": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "eventId": {"type": "string"},
                    "originalChord": {"type": "string"},
                    "recommendedChord": {"type": "string"},
                    "status": {"type": "string", "enum": sorted(REVIEW_STATUSES)},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "reason": {"type": "string"},
                    "alternatives": {"type": "array", "items": {"type": "string"}},
                    "candidateRanking": {"type": "array", "items": {"type": "string"}},
                    "needsHumanReview": {"type": "boolean"},
                },
                "required": [
                    "eventId", "originalChord", "recommendedChord", "status",
                    "confidence", "reason", "alternatives", "candidateRanking",
                    "needsHumanReview",
                ],
            },
        },
    },
    "required": ["reviews"],
}

REVIEW_INSTRUCTIONS = """You are an evidence reviewer for an already completed chord chart.
Report what the supplied audio evidence supports. Do not reharmonize.

Rules:
- When chartAuthority is true, the uploaded chart is the harmonic ground truth.
  Keep originalChord as recommendedChord. Audio may confirm it, flag a conflict,
  or identify a possible extension/inversion, but it may not silently replace it.
- Evidence authority is chart chord, then bass, then accompaniment harmony, then melody.
  melodyNotes have the lowest authority and must never create a chord by themselves.
- Never add a chord because it is common, theoretically attractive, or would sound good.
- recommendedChord, alternatives, and candidateRanking may contain only originalChord or
  the supplied alternateCandidates for that event. Never invent a chord symbol.
- Preserve a high-confidence original unless the supplied notes, bass, repeated occurrence,
  and candidate scores strongly support one supplied correction.
- Evaluate bassNote separately from detectedNotes. Use a slash chord only when a supplied
  slash candidate explains the bass and sustained upper notes.
- Use previous/next harmony, key, resolution, bass movement, and matching repeated sections.
- A brief melody or passing note is not a chord extension. detectedNotes contain only notes
  that passed the persistence filter, but still prefer sustained chord-tone evidence.
- Confirmed means the original is strongly supported. Likely means one supplied reading is
  better supported. Ambiguous means multiple supplied readings remain plausible. Unknown
  means the evidence is insufficient.
- When evidence is insufficient, keep originalChord, rank possible supplied alternatives,
  set needsHumanReview true, and explain the uncertainty briefly.
- Give a short evidence-based reason for every item, especially every correction.
- User correction examples are calibration evidence only. They never authorize a chord that
  is absent from the current event's candidates.
"""


def _finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
        return number if number == number and abs(number) != float("inf") else fallback
    except (TypeError, ValueError):
        return fallback


def _pitch_class(note: Any) -> int | None:
    value = str(note or "").strip().replace("#", "♯").replace("b", "♭")
    match = re.match(r"^([A-G](?:[♯♭])?)", value)
    return _PITCH_CLASSES.get(match.group(1)) if match else None


def _chord_tones(symbol: str) -> set[int]:
    """Return pitch classes for evidence comparison, never a display spelling."""
    value = str(symbol or "").strip().replace("#", "♯").replace("b", "♭")
    match = re.match(r"^([A-G](?:[♯♭])?)([^/]*)", value)
    if not match or match.group(1) not in _PITCH_CLASSES:
        return set()
    root = _PITCH_CLASSES[match.group(1)]
    quality = match.group(2).lower()
    if "m7♭5" in quality or "ø" in quality:
        intervals = {0, 3, 6, 10}
    elif "dim7" in quality:
        intervals = {0, 3, 6, 9}
    elif "dim" in quality or "°" in quality:
        intervals = {0, 3, 6}
    elif "sus2" in quality:
        intervals = {0, 2, 7}
    elif "sus" in quality:
        intervals = {0, 5, 7}
    elif quality.startswith("m") and not quality.startswith("maj"):
        intervals = {0, 3, 7}
    else:
        intervals = {0, 4, 7}
    if "maj7" in quality:
        intervals.add(11)
    elif any(token in quality for token in ("7", "9", "11", "13")):
        intervals.add(10)
    if "9" in quality:
        intervals.add(2)
    if "11" in quality:
        intervals.add(5)
    if "13" in quality:
        intervals.add(9)
    return {(root + interval) % 12 for interval in intervals}


def _slash_bass(symbol: str) -> int | None:
    return _pitch_class(symbol.rsplit("/", 1)[1]) if "/" in symbol else None


def _note_fit(symbol: str, notes: list[str]) -> float:
    tones = _chord_tones(symbol)
    detected = {pitch for pitch in (_pitch_class(note) for note in notes) if pitch is not None}
    if not tones or not detected:
        return 0.0
    common = len(tones & detected)
    return 0.62 * common / len(tones) + 0.38 * common / len(detected)


def _context_continuity(symbol: str, record: dict[str, Any]) -> float:
    """Use neighbors only as a tiny tie-breaker, never as harmonic invention."""
    tones = _chord_tones(symbol)
    if not tones:
        return 0.0
    continuity = 0.0
    for field in ("previousChord", "nextChord"):
        neighbor = _chord_tones(str(record.get(field) or ""))
        if neighbor:
            continuity += min(0.012, 0.012 * len(tones & neighbor) / max(1, min(len(tones), len(neighbor))))
    return continuity


def _local_evidence_reviews(
    records: list[dict[str, Any]],
    learning_examples: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Rank supplied candidates locally when no external model is configured.

    The audio scorer remains authoritative. Bass, stable upper notes, repeated
    sections, neighbors, and prior user corrections may corroborate a reading,
    but none of them can introduce a chord that was not already detected.
    """
    reviews: list[dict[str, Any]] = []
    for record in records:
        original = record["originalChord"]
        allowed = list(dict.fromkeys([original, *record.get("alternateCandidates", [])]))
        if record.get("chartAuthority"):
            scores = {
                str(item.get("chord")): _finite(item.get("score"))
                for item in record.get("candidateScores") or [] if isinstance(item, dict)
            }
            ranking = sorted(allowed, key=lambda chord: (scores.get(chord, 0.0), chord == original), reverse=True)
            if original in ranking:
                ranking.remove(original)
            ranking.insert(0, original)
            agreement = max(0.0, min(1.0, _finite(record.get("chartAudioAgreement"), 0.0)))
            audio_confidence = max(0.0, min(1.0, _finite(record.get("confidenceScore"), 0.0)))
            conflict = record.get("conflictingAudioInterpretation")
            locked = bool(record.get("locked"))
            if agreement >= .82:
                status, needs_review = "Confirmed", False
                reason = "The chart chord is supported by the bass and sustained accompaniment evidence."
            elif agreement >= .58:
                status, needs_review = "Likely", False
                reason = "The chart chord remains supported; the additional audio notes are treated as voicing, suspension, or ornamentation."
            elif audio_confidence < .35:
                status, needs_review = "Unknown", True
                reason = "Audio evidence is too weak to verify this chart chord, so the chart was preserved."
            else:
                status, needs_review = "Ambiguous", True
                reason = f"The chart chord was preserved while the audio detector also heard {conflict}." if conflict else "The chart chord was preserved because the audio evidence is ambiguous."
            if locked:
                reason = f"Locked chart chord {original} was preserved. " + reason
            reviews.append({
                "eventId": record["eventId"], "originalChord": original,
                "recommendedChord": original, "status": status,
                "confidence": round(max(agreement, audio_confidence), 3),
                "reason": reason[:320], "alternatives": ranking[1:],
                "candidateRanking": ranking, "needsHumanReview": needs_review,
            })
            continue
        raw_scores = {
            str(item.get("chord")): _finite(item.get("score"))
            for item in record.get("candidateScores") or []
            if isinstance(item, dict) and str(item.get("chord") or "") in allowed
        }
        detector_confidence = max(0.0, min(1.0, _finite(record.get("confidenceScore"), .5)))
        raw_scores.setdefault(original, detector_confidence)
        detected_notes = list(record.get("detectedNotes") or [])
        detected_bass = _pitch_class(record.get("bassNote"))
        adjusted: dict[str, float] = {}
        evidence: dict[str, dict[str, float]] = {}
        for candidate in allowed:
            note_fit = _note_fit(candidate, detected_notes)
            bass_support = 0.0
            written_bass = _slash_bass(candidate)
            root = _pitch_class(candidate)
            if detected_bass is not None:
                if written_bass is not None:
                    bass_support = .09 if written_bass == detected_bass else -.16
                elif root == detected_bass:
                    bass_support = .025
            repeated_support = 0.0
            repeated = [item for item in record.get("repeatedOccurrences") or [] if isinstance(item, dict)]
            repeated_weight = sum(max(.2, _finite(item.get("confidence"), .5)) for item in repeated)
            if repeated_weight:
                matched = sum(
                    max(.2, _finite(item.get("confidence"), .5))
                    for item in repeated if item.get("chord") == candidate
                )
                repeated_support = .075 * matched / repeated_weight
            learned_support = 0.0
            for example in learning_examples[-40:]:
                if not isinstance(example, dict) or example.get("finalCorrection") != candidate:
                    continue
                same_original = example.get("originalResult") == original
                same_bass = _pitch_class(example.get("bassNote")) == detected_bass and detected_bass is not None
                if same_original and same_bass:
                    learned_support = max(learned_support, .025)
            context = _context_continuity(candidate, record)
            # Audio score dominates. The remaining evidence is deliberately
            # bounded so context can corroborate but cannot manufacture a fix.
            score = (
                .76 * raw_scores.get(candidate, 0.0)
                + .14 * note_fit
                + bass_support
                + repeated_support
                + learned_support
                + context
            )
            adjusted[candidate] = max(0.0, min(1.0, score))
            evidence[candidate] = {
                "noteFit": note_fit,
                "bassSupport": bass_support,
                "repeatedSupport": repeated_support,
            }

        ranking = sorted(allowed, key=lambda chord: (adjusted[chord], raw_scores.get(chord, 0.0), chord == original), reverse=True)
        top = ranking[0]
        runner_up = ranking[1] if len(ranking) > 1 else None
        margin = adjusted[top] - (adjusted[runner_up] if runner_up else 0.0)
        raw_gain = raw_scores.get(top, 0.0) - raw_scores.get(original, 0.0)
        corroborated = (
            evidence[top]["noteFit"] >= evidence[original]["noteFit"] + .08
            or evidence[top]["bassSupport"] >= .08
            or evidence[top]["repeatedSupport"] >= .045
        )
        high_confidence_override = (
            detector_confidence >= .85
            and top != original
            and raw_gain >= .08
            and margin >= .12
            and adjusted[top] >= .78
            and corroborated
        )
        ordinary_correction = (
            detector_confidence < .85
            and top != original
            and raw_gain >= .08
            and margin >= .075
            and adjusted[top] >= .58
            and corroborated
        )

        if high_confidence_override or ordinary_correction:
            recommended = top
            status = "Likely"
            confidence = .93 if high_confidence_override else min(.91, max(.74, .68 + margin + max(0.0, raw_gain) * .35))
            details: list[str] = []
            if evidence[top]["noteFit"] >= evidence[original]["noteFit"] + .08 and detected_notes:
                details.append(f"the sustained upper notes ({', '.join(detected_notes)}) fit {top} better")
            if evidence[top]["bassSupport"] >= .08 and record.get("bassNote"):
                details.append(f"its written bass matches the detected {record['bassNote']}")
            if evidence[top]["repeatedSupport"] >= .045:
                details.append("a clearer repeated occurrence supports the same reading")
            detail_text = "; ".join(details)
            reason = detail_text[:1].upper() + detail_text[1:] + "."
            needs_review = False
        elif detector_confidence >= .85 and top == original:
            recommended = original
            status = "Confirmed"
            confidence = detector_confidence
            reason = "The original chord remains the strongest audio-supported candidate."
            needs_review = False
        elif not runner_up and detector_confidence < .4:
            recommended = original
            status = "Unknown"
            confidence = detector_confidence
            reason = "The audio evidence is too weak to distinguish a reliable chord reading."
            needs_review = True
        elif runner_up and (top != original or margin < .075):
            recommended = original
            status = "Ambiguous"
            confidence = min(.79, max(.4, detector_confidence, adjusted[top]))
            reason = f"{original} and {top if top != original else runner_up} remain too close in the supplied audio evidence."
            needs_review = True
        else:
            recommended = original
            status = "Likely"
            confidence = max(.55, detector_confidence)
            reason = "The original chord is the best supplied reading, though the evidence is not strong enough to mark confirmed."
            needs_review = False

        reviews.append({
            "eventId": record["eventId"],
            "originalChord": original,
            "recommendedChord": recommended,
            "status": status,
            "confidence": round(max(0.0, min(1.0, confidence)), 3),
            "reason": reason[:320],
            "alternatives": [candidate for candidate in ranking if candidate != recommended],
            "candidateRanking": ranking,
            "needsHumanReview": needs_review,
        })
    return validate_review_payload({"reviews": reviews}, records)


def _closest_beat(beats: list[float], timestamp: float, bpm: float) -> int:
    if not beats:
        return max(0, round(timestamp * bpm / 60.0))
    return min(range(len(beats)), key=lambda index: abs(beats[index] - timestamp))


def _section_names(chunks: list[list[dict[str, Any]]]) -> list[str]:
    signatures = ["|".join(
        ",".join(str(event.get("originalChord") or event.get("chordSymbol") or "?") for event in measure)
        for measure in chunk
    ) for chunk in chunks]
    counts = {signature: signatures.count(signature) for signature in signatures}
    names: dict[str, str] = {}
    used: set[str] = set()
    occurrences: dict[str, int] = {}
    output: list[str] = []
    for index, signature in enumerate(signatures):
        base = names.get(signature)
        if not base:
            if index == 0 and len(chunks) >= 3 and counts[signature] == 1:
                base = "Intro"
            elif index == len(chunks) - 1 and len(chunks) >= 4 and len(chunks[index]) < 4:
                base = "Outro"
            elif "Verse" not in used:
                base = "Verse"
            elif "Chorus" not in used:
                base = "Chorus"
            else:
                base = "Bridge"
            names[signature] = base
            used.add(base)
        occurrence = occurrences.get(base, 0) + 1
        occurrences[base] = occurrence
        output.append(f"{base} {occurrence}" if occurrence > 1 else base)
    return output


def _matching_phrase_for_review(left: list[list[dict[str, Any]]], right: list[list[dict[str, Any]]]) -> bool:
    """Match repeated phrases while treating low-confidence slots as wildcards."""
    left_slots = {
        (measure_index, int(event.get("_beat") or 1)): event
        for measure_index, measure in enumerate(left)
        for event in measure
    }
    right_slots = {
        (measure_index, int(event.get("_beat") or 1)): event
        for measure_index, measure in enumerate(right)
        for event in measure
    }
    common = set(left_slots) & set(right_slots)
    if not common:
        return False
    compared = 0
    for position in common:
        left_event, right_event = left_slots[position], right_slots[position]
        if min(_finite(left_event.get("confidenceScore"), .5), _finite(right_event.get("confidenceScore"), .5)) < .67:
            continue
        compared += 1
        left_chord = str(left_event.get("originalChord") or left_event.get("chordSymbol") or "?")
        right_chord = str(right_event.get("originalChord") or right_event.get("chordSymbol") or "?")
        if left_chord != right_chord:
            return False
    return compared >= max(1, len(common) // 2)


def build_review_records(
    events: list[dict[str, Any]],
    *,
    key: str,
    mode: str,
    bpm: float,
    beat_times: Iterable[float],
) -> list[dict[str, Any]]:
    """Attach chart position, neighbors, and repeated-section evidence."""
    beats = [_finite(value, -1) for value in beat_times]
    beats = [value for value in beats if value >= 0]
    tempo = max(30.0, _finite(bpm, 72.0))
    ordered = sorted((dict(event) for event in events), key=lambda event: _finite(event.get("startTime")))
    by_absolute_measure: dict[int, list[dict[str, Any]]] = {}
    for index, event in enumerate(ordered):
        event.setdefault("eventId", f"detected-{index + 1}")
        beat_index = _closest_beat(beats, _finite(event.get("startTime")), tempo)
        absolute_measure = beat_index // 4
        event["_absoluteMeasure"] = absolute_measure
        event["_beat"] = beat_index % 4 + 1
        by_absolute_measure.setdefault(absolute_measure, []).append(event)

    compact_measures = [
        sorted(by_absolute_measure[number], key=lambda event: (event["_beat"], _finite(event.get("startTime"))))
        for number in sorted(by_absolute_measure)
    ]
    chunks = [compact_measures[index:index + 4] for index in range(0, len(compact_measures), 4)]
    names = _section_names(chunks)
    locations: dict[str, tuple[int, int, int]] = {}
    for chunk_index, chunk in enumerate(chunks):
        for relative_measure, measure in enumerate(chunk):
            compact_number = chunk_index * 4 + relative_measure + 1
            for event in measure:
                locations[str(event["eventId"])] = (chunk_index, compact_number, relative_measure)

    records: list[dict[str, Any]] = []
    for index, event in enumerate(ordered):
        event_id = str(event["eventId"])
        chunk_index, compact_measure, relative_measure = locations[event_id]
        chunk = chunks[chunk_index]
        repeated: list[dict[str, Any]] = []
        for other_chunk_index, other_chunk in enumerate(chunks):
            if other_chunk_index == chunk_index or relative_measure >= len(other_chunk) or not _matching_phrase_for_review(chunk, other_chunk):
                continue
            same_beat = next((item for item in other_chunk[relative_measure] if item["_beat"] == event["_beat"]), None)
            if same_beat:
                repeated.append({
                    "section": names[other_chunk_index],
                    "chord": str(same_beat.get("originalChord") or same_beat.get("chordSymbol") or "?"),
                    "confidence": round(_finite(same_beat.get("confidenceScore"), 0.5), 3),
                    "bassNote": same_beat.get("bassNote"),
                    "detectedNotes": list(same_beat.get("detectedNotes") or []),
                })
        records.append({
            "eventId": event_id,
            "key": key,
            "mode": mode,
            "tempo": round(tempo, 2),
            "section": names[chunk_index],
            "measure": compact_measure,
            "beat": int(event["_beat"]),
            "timestamp": round(_finite(event.get("startTime")), 4),
            "endTimestamp": round(_finite(event.get("endTime")), 4),
            "bassNote": event.get("bassNote"),
            "detectedNotes": list(event.get("detectedNotes") or []),
            "accompanimentNotes": list(event.get("accompanimentNotes") or event.get("detectedNotes") or []),
            "melodyNotes": list(event.get("melodyNotes") or []),
            "originalChord": str(event.get("originalChord") or event.get("chordSymbol") or "?"),
            "confidenceScore": round(_finite(event.get("confidenceScore"), 0.5), 3),
            "alternateCandidates": list(event.get("alternateCandidates") or []),
            "candidateScores": list(event.get("candidateScores") or []),
            "previousChord": str(ordered[index - 1].get("originalChord") or ordered[index - 1].get("chordSymbol")) if index else None,
            "nextChord": str(ordered[index + 1].get("originalChord") or ordered[index + 1].get("chordSymbol")) if index + 1 < len(ordered) else None,
            "previousBassNote": ordered[index - 1].get("bassNote") if index else None,
            "nextBassNote": ordered[index + 1].get("bassNote") if index + 1 < len(ordered) else None,
            "repeatedOccurrences": repeated,
            "chartAuthority": bool(event.get("chartAuthority")),
            "chartChord": event.get("chartChord"),
            "locked": bool(event.get("locked")),
            "chartAudioAgreement": round(_finite(event.get("chartAudioAgreement")), 3),
            "conflictingAudioInterpretation": event.get("conflictingAudioInterpretation"),
            "possibleExtension": event.get("possibleExtension"),
        })
        if event.get("chartAuthority"):
            records[-1]["section"] = str(event.get("section") or records[-1]["section"])
            records[-1]["measure"] = int(event.get("measure") or records[-1]["measure"])
            records[-1]["beat"] = int(event.get("beat") or records[-1]["beat"])
    return records


def _response_text(payload: dict[str, Any]) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct
    for item in payload.get("output") or []:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if isinstance(content, dict) and content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"]
    raise ValueError("The reviewer returned no structured output.")


def validate_review_payload(payload: Any, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Validate both JSON shape and the no-invention candidate boundary."""
    if not isinstance(payload, dict) or set(payload) != {"reviews"} or not isinstance(payload["reviews"], list):
        raise ValueError("Invalid review response shape.")
    expected = {record["eventId"]: record for record in records}
    if len(payload["reviews"]) != len(records):
        raise ValueError("The review response is incomplete.")
    validated: list[dict[str, Any]] = []
    seen: set[str] = set()
    required = {
        "eventId", "originalChord", "recommendedChord", "status", "confidence",
        "reason", "alternatives", "candidateRanking", "needsHumanReview",
    }
    for item in payload["reviews"]:
        if not isinstance(item, dict) or set(item) != required:
            raise ValueError("A review item did not match the strict schema.")
        event_id = item.get("eventId")
        if not isinstance(event_id, str) or event_id in seen or event_id not in expected:
            raise ValueError("A review item has an unknown event id.")
        record = expected[event_id]
        original = record["originalChord"]
        allowed = {original, *record["alternateCandidates"]}
        if item.get("originalChord") != original or item.get("recommendedChord") not in allowed:
            raise ValueError("The reviewer suggested a chord outside the audio candidates.")
        if record.get("chartAuthority") and item.get("recommendedChord") != original:
            raise ValueError("A chart-first review cannot replace the uploaded chart chord.")
        if item.get("status") not in REVIEW_STATUSES:
            raise ValueError("The reviewer returned an unsupported status.")
        confidence = _finite(item.get("confidence"), -1)
        if confidence < 0 or confidence > 1:
            raise ValueError("The reviewer returned an invalid confidence.")
        if not isinstance(item.get("reason"), str) or not item["reason"].strip() or len(item["reason"]) > 320:
            raise ValueError("The reviewer reason is invalid.")
        if not isinstance(item.get("needsHumanReview"), bool):
            raise ValueError("The reviewer flag is invalid.")
        for field in ("alternatives", "candidateRanking"):
            value = item.get(field)
            if not isinstance(value, list) or any(not isinstance(chord, str) or chord not in allowed for chord in value):
                raise ValueError("The reviewer ranked an unsupported chord.")
            if len(value) != len(set(value)):
                raise ValueError("The reviewer repeated a ranked chord.")
        ranking = item["candidateRanking"]
        if set(ranking) != allowed:
            raise ValueError("The reviewer did not rank every supplied candidate.")
        if item["status"] == "Confirmed" and item["recommendedChord"] != original:
            raise ValueError("A confirmed chord cannot replace the original.")
        if item["status"] in {"Ambiguous", "Unknown"} and item["recommendedChord"] != original:
            raise ValueError("Uncertain evidence must retain the original chord.")
        # A high-confidence detector can change only when an audio-scored
        # candidate is substantially stronger and the reviewer is emphatic.
        detector_confidence = _finite(record.get("confidenceScore"), 0.5)
        if detector_confidence >= 0.85 and item["recommendedChord"] != original:
            scores = {entry.get("chord"): _finite(entry.get("score")) for entry in record.get("candidateScores") or [] if isinstance(entry, dict)}
            if confidence < 0.92 or scores.get(item["recommendedChord"], 0) < scores.get(original, detector_confidence) + 0.08:
                raise ValueError("A high-confidence chord lacked strong correction evidence.")
        copy = dict(item)
        copy["confidence"] = round(confidence, 3)
        validated.append(copy)
        seen.add(event_id)
    return validated


def _fallback_reviews(records: list[dict[str, Any]], reason: str) -> list[dict[str, Any]]:
    reviews: list[dict[str, Any]] = []
    for record in records:
        confidence = _finite(record.get("confidenceScore"), 0.5)
        status = "Confirmed" if confidence >= 0.85 else "Likely" if confidence >= 0.67 else "Ambiguous" if confidence >= 0.4 else "Unknown"
        original = record["originalChord"]
        ranking = [original, *[candidate for candidate in record["alternateCandidates"] if candidate != original]]
        reviews.append({
            "eventId": record["eventId"],
            "originalChord": original,
            "recommendedChord": original,
            "status": status,
            "confidence": round(confidence, 3),
            "reason": reason,
            "alternatives": ranking[1:],
            "candidateRanking": ranking,
            "needsHumanReview": status in {"Ambiguous", "Unknown"},
        })
    return reviews


def _request_batch(records: list[dict[str, Any]], learning_examples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")
    model = os.environ.get("OPENAI_REVIEW_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    request_body = {
        "model": model,
        "instructions": REVIEW_INSTRUCTIONS,
        "input": json.dumps({"completedChordChart": records, "userCorrectionExamples": learning_examples[-40:]}, ensure_ascii=False, separators=(",", ":")),
        "text": {"format": {"type": "json_schema", "name": "faithful_keys_chord_review", "strict": True, "schema": REVIEW_SCHEMA}},
        "store": False,
    }
    timeout = max(10.0, _finite(os.environ.get("OPENAI_REVIEW_TIMEOUT_SECONDS"), 45.0))
    response = httpx.post(
        "https://api.openai.com/v1/responses",
        headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"},
        json=request_body,
        timeout=timeout,
    )
    response.raise_for_status()
    return validate_review_payload(json.loads(_response_text(response.json())), records)


def review_completed_chart(
    events: list[dict[str, Any]],
    *,
    key: str,
    mode: str,
    bpm: float,
    beat_times: Iterable[float],
    learning_examples: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Review a completed chart and apply only validated candidate choices."""
    records = build_review_records(events, key=key, mode=mode, bpm=bpm, beat_times=beat_times)
    if not records:
        return events, {"status": "completed", "provider": "none", "model": None, "reviewedEvents": 0}
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        # No paid API is required: the local reviewer uses only audio-scored
        # candidates and passes through the same strict validator as AI output.
        reviews = _local_evidence_reviews(records, learning_examples or [])
        review_status = {
            "status": "completed", "provider": "local-evidence",
            "model": LOCAL_REVIEW_MODEL, "reviewedEvents": len(reviews),
        }
    else:
        try:
            reviews = []
            for start in range(0, len(records), MAX_REVIEW_BATCH):
                batch = records[start:start + MAX_REVIEW_BATCH]
                reviews.extend(_request_batch(batch, learning_examples or []))
            # Revalidate the assembled response before applying anything.
            reviews = validate_review_payload({"reviews": reviews}, records)
            review_status = {"status": "completed", "provider": "openai", "model": os.environ.get("OPENAI_REVIEW_MODEL", "gpt-4o-mini"), "reviewedEvents": len(reviews)}
        except Exception as error:
            # An attempted AI review is never replaced with speculative output.
            # Its invalid/unavailable result retains the completed detector chart.
            reviews = _fallback_reviews(records, "AI review unavailable or invalid; the completed audio detection was retained.")
            review_status = {"status": "unavailable", "provider": "fallback", "model": None, "reviewedEvents": 0, "error": type(error).__name__}

    by_id = {item["eventId"]: item for item in reviews}
    reviewed: list[dict[str, Any]] = []
    for event, record in zip(sorted(events, key=lambda item: _finite(item.get("startTime"))), records):
        decision = by_id[record["eventId"]]
        original = record["originalChord"]
        apply_correction = (
            review_status["status"] == "completed"
            and decision["status"] == "Likely"
            and decision["confidence"] >= 0.72
            and decision["recommendedChord"] != original
            and not record.get("chartAuthority")
        )
        reviewed.append({
            **event,
            "eventId": record["eventId"],
            "originalChord": original,
            "chordSymbol": decision["recommendedChord"] if apply_correction else original,
            "section": record["section"],
            "measure": record["measure"],
            "beat": record["beat"],
            "review": decision,
        })
    return reviewed, review_status
