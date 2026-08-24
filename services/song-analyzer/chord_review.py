"""Constrained, post-recognition review for completed chord charts.

The recognizer and spectral pass remain authoritative sources of candidates.
This module may rank those candidates, but it never creates a chord symbol.
Any unavailable, invalid, or unsupported model response returns the completed
deterministic chart unchanged.
"""

from __future__ import annotations

import json
import os
from typing import Any, Iterable

import httpx


REVIEW_STATUSES = {"Confirmed", "Likely", "Ambiguous", "Unknown"}
MAX_REVIEW_BATCH = 40

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
            "originalChord": str(event.get("originalChord") or event.get("chordSymbol") or "?"),
            "confidenceScore": round(_finite(event.get("confidenceScore"), 0.5), 3),
            "alternateCandidates": list(event.get("alternateCandidates") or []),
            "candidateScores": list(event.get("candidateScores") or []),
            "previousChord": str(ordered[index - 1].get("originalChord") or ordered[index - 1].get("chordSymbol")) if index else None,
            "nextChord": str(ordered[index + 1].get("originalChord") or ordered[index + 1].get("chordSymbol")) if index + 1 < len(ordered) else None,
            "previousBassNote": ordered[index - 1].get("bassNote") if index else None,
            "nextBassNote": ordered[index + 1].get("bassNote") if index + 1 < len(ordered) else None,
            "repeatedOccurrences": repeated,
        })
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
    try:
        reviews: list[dict[str, Any]] = []
        for start in range(0, len(records), MAX_REVIEW_BATCH):
            batch = records[start:start + MAX_REVIEW_BATCH]
            reviews.extend(_request_batch(batch, learning_examples or []))
        # Revalidate the assembled response before applying anything.
        reviews = validate_review_payload({"reviews": reviews}, records)
        review_status = {"status": "completed", "provider": "openai", "model": os.environ.get("OPENAI_REVIEW_MODEL", "gpt-4o-mini"), "reviewedEvents": len(reviews)}
    except Exception as error:
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
