"""Private, short-lived audio analysis worker for Faithful Keys.

This service is intentionally separate from the GitHub Pages client. It accepts
only a pre-authorized, already-uploaded object reference from an authenticated
orchestrator; it never fetches YouTube media and never returns audio or stems.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import logging
import inspect
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from chord_review import review_completed_chart
from chart_first import align_chart_to_audio


_PITCH_CLASSES = {"C": 0, "B♯": 0, "C♯": 1, "D♭": 1, "D": 2, "D♯": 3, "E♭": 3, "E": 4, "F♭": 4, "E♯": 5, "F": 5, "F♯": 6, "G♭": 6, "G": 7, "G♯": 8, "A♭": 8, "A": 9, "A♯": 10, "B♭": 10, "B": 11, "C♭": 11}
_PREFERRED_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"]
_SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]


class AnalysisStageError(RuntimeError):
    """A short, non-sensitive failure label that is safe to show in the UI."""


def normalize_chord_symbol(symbol: str) -> str:
    """Translate common recognizer labels into the editable chart notation.

    The recognizer may emit Harte-style labels such as ``C:maj`` or ``D:min7``.
    This deliberately changes syntax only—not a written root's enharmonic name.
    """
    value = symbol.strip().replace("#", "♯").replace("b", "♭")
    if not value or value in {"N", "X", "?"}:
        return "?"
    match = re.match(r"^([A-G](?:[♯♭])?)(?::)?(.*)$", value)
    if not match:
        return value
    root, quality = match.groups()
    quality = quality.strip().lower().replace("(", "").replace(")", "")
    aliases = {
        "": "", "maj": "", "major": "", "min": "m", "minor": "m",
        "maj7": "maj7", "major7": "maj7", "min7": "m7", "minor7": "m7",
        "7": "7", "dom7": "7", "dim": "dim", "dim7": "dim7",
        "hdim7": "m7♭5", "min7b5": "m7♭5", "min7♭5": "m7♭5", "sus4": "sus4", "sus2": "sus2",
    }
    return f"{root}{aliases.get(quality, quality.replace('b', '♭').replace('#', '♯'))}"


def infer_key(events: list[dict[str, Any]]) -> dict[str, str]:
    """Provide a conservative key suggestion from recognized chord roots.

    This is intentionally a suggestion, not a claim of certain harmonic
    analysis. The UI keeps the key editable for modal, borrowed, and ambiguous
    recordings.
    """
    parsed: list[tuple[int, bool]] = []
    for event in events:
        symbol = normalize_chord_symbol(str(event.get("chordSymbol") or ""))
        match = re.match(r"^([A-G](?:[♯♭])?)(.*)$", symbol)
        if not match or match.group(1) not in _PITCH_CLASSES:
            continue
        parsed.append((_PITCH_CLASSES[match.group(1)], match.group(2).startswith("m") and not match.group(2).startswith("maj")))
    if not parsed:
        return {"key": "C", "mode": "major"}
    major_scale = {0, 2, 4, 5, 7, 9, 11}
    minor_scale = {0, 2, 3, 5, 7, 8, 10}
    final_root = parsed[-1][0]
    candidates: list[tuple[float, int, str]] = []
    for tonic in range(12):
        for mode, intervals in (("major", major_scale), ("minor", minor_scale)):
            scale = {(tonic + interval) % 12 for interval in intervals}
            score = sum(1.0 for root, _ in parsed if root in scale)
            score += 2.5 if final_root == tonic else 0
            score += 0.4 * sum(1 for root, is_minor in parsed if root == tonic and (is_minor == (mode == "minor")))
            candidates.append((score, tonic, mode))
    _, tonic, mode = max(candidates, key=lambda item: item[0])
    return {"key": _PREFERRED_NAMES[tonic], "mode": mode}


@dataclass(frozen=True)
class AnalysisInput:
    job_id: str
    user_id: str
    source_path: Path
    title: str
    learning_examples: tuple[dict[str, Any], ...] = ()
    reference_chart: dict[str, Any] | None = None


def _parse_lab(path: Path) -> list[dict[str, Any]]:
    """Read timestamped chord labels without fabricating uncertain harmony."""
    events: list[dict[str, Any]] = []
    for row in path.read_text(encoding="utf-8").splitlines():
        fields = row.split()
        if len(fields) < 3:
            continue
        try:
            start, end = float(fields[0]), float(fields[1])
        except ValueError:
            continue
        chord = normalize_chord_symbol(" ".join(fields[2:]).strip())
        if chord and chord not in {"N", "X"}:
            events.append({
                "eventId": f"detected-{len(events) + 1}",
                "startTime": start,
                "endTime": end,
                "chordSymbol": chord,
                "confidence": "medium",
            })
    return events


def _root_pitch_class(symbol: str) -> int | None:
    match = re.match(r"^([A-G](?:[♯♭])?)", normalize_chord_symbol(symbol))
    return _PITCH_CLASSES.get(match.group(1)) if match else None


def _expected_seventh_interval(root_pc: int, suffix: str, key_hint: dict[str, str], next_symbol: str | None) -> int | None:
    """Return the seventh expected by diatonic role or dominant motion."""
    next_root = _root_pitch_class(next_symbol or "")
    # A major triad resolving down a fifth is a dominant even when it is a
    # secondary dominant outside the current key.
    if suffix == "" and next_root is not None and (next_root - root_pc) % 12 == 5:
        return 10

    tonic = _PITCH_CLASSES.get(str(key_hint.get("key") or ""))
    if tonic is None:
        return None
    degree = (root_pc - tonic) % 12
    mode = key_hint.get("mode")
    if mode == "major":
        expected = {
            (0, ""): 11, (2, "m"): 10, (4, "m"): 10,
            (5, ""): 11, (7, ""): 10, (9, "m"): 10,
            (11, "dim"): 10,
        }
    else:
        expected = {
            (0, "m"): 10, (2, "dim"): 10, (3, ""): 11,
            (5, "m"): 10, (7, ""): 10, (8, ""): 11,
            (10, ""): 10,
        }
    return expected.get((degree, suffix))


def infer_seventh_symbol(
    symbol: str,
    strengths: list[float],
    persistence: list[float] | None = None,
    key_hint: dict[str, str] | None = None,
    next_symbol: str | None = None,
) -> str:
    """Restore a seventh only when the recording and harmonic role agree.

    Theory selects the likely spelling (Imaj7, ii7, V7, viiø7, or a secondary
    dominant), while chroma energy remains mandatory. Strong non-diatonic
    evidence can still win so borrowed harmony is not flattened into triads.
    """
    normalized = normalize_chord_symbol(symbol)
    match = re.match(r"^([A-G](?:[♯♭])?)(.*)$", normalized)
    if not match or len(strengths) != 12:
        return normalized
    root, suffix = match.groups()
    if root not in _PITCH_CLASSES:
        return normalized
    if suffix == "":
        core, candidates = (0, 4, 7), ((10, "7"), (11, "maj7"))
    elif suffix == "m":
        core, candidates = (0, 3, 7), ((10, "m7"), (11, "mMaj7"))
    elif suffix == "dim":
        core, candidates = (0, 3, 6), ((9, "dim7"), (10, "m7♭5"))
    else:
        return normalized

    root_pc = _PITCH_CLASSES[root]
    core_pcs = {(root_pc + interval) % 12 for interval in core}
    core_values = sorted(max(0.0, float(strengths[index])) for index in core_pcs)
    guide_anchor = core_values[len(core_values) // 2] if core_values else 0.0
    candidate_pcs = {(root_pc + interval) % 12 for interval, _ in candidates}
    background = sorted(
        max(0.0, float(value)) for index, value in enumerate(strengths)
        if index not in core_pcs and index not in candidate_pcs
    )
    noise_floor = background[len(background) // 2] if background else 0.0
    threshold = max(0.055, guide_anchor * 0.40, noise_floor * 1.50)
    presence = persistence if persistence is not None and len(persistence) == 12 else [1.0] * 12
    expected = _expected_seventh_interval(root_pc, suffix, key_hint or {}, next_symbol)

    supported: list[tuple[float, int, str]] = []
    for interval, output_suffix in candidates:
        pc = (root_pc + interval) % 12
        energy = max(0.0, float(strengths[pc]))
        lasting = float(presence[pc])
        theory_supported = interval == expected
        required_energy = threshold if theory_supported else threshold * 1.18
        required_persistence = 0.42 if theory_supported else 0.56
        if energy >= required_energy and lasting >= required_persistence:
            theory_bonus = 1.18 if theory_supported else 1.0
            supported.append((energy * theory_bonus, interval, output_suffix))
    if not supported:
        return normalized
    _, _, chosen_suffix = max(supported, key=lambda candidate: candidate[0])
    return f"{root}{chosen_suffix}"


def infer_extension_symbol(symbol: str, strengths: list[float], persistence: list[float] | None = None) -> str:
    """Add only color tones that are consistently present in a chord segment.

    ChordMini's 170-class vocabulary deliberately folds 9ths, 11ths, and 13ths
    into its seventh-chord classes. This second, conservative chroma pass keeps
    the model's root and basic quality, then restores audible color tones. It
    does not turn every seventh chord into an extended chord: a candidate must
    be strong relative to both the guide tones and the non-chord noise floor,
    and it must persist through almost half of the segment.
    """
    normalized = normalize_chord_symbol(symbol)
    match = re.match(r"^([A-G](?:[♯♭])?)(.*)$", normalized)
    if not match or len(strengths) != 12:
        return normalized
    root, suffix = match.groups()
    if root not in _PITCH_CLASSES or re.search(r"(?:9|11|13|add)", suffix, re.IGNORECASE):
        return normalized

    # Only enrich reliable seventh-chord predictions. A triad plus a melodic
    # non-chord tone is not enough evidence to relabel the harmony.
    if suffix == "maj7":
        core, candidates = (0, 4, 7, 11), ((2, "add9"), (6, "♯11"), (9, "add13"))
    elif suffix == "m7":
        core, candidates = (0, 3, 7, 10), ((2, "add9"), (5, "add11"), (9, "add13"))
    elif suffix == "7":
        core, candidates = (0, 4, 7, 10), (
            (1, "♭9"), (2, "add9"), (3, "♯9"),
            (6, "♯11"), (8, "♭13"), (9, "add13"),
        )
    else:
        return normalized

    root_pc = _PITCH_CLASSES[root]
    core_pcs = {(root_pc + interval) % 12 for interval in core}
    core_values = sorted(max(0.0, float(strengths[index])) for index in core_pcs)
    # The fifth may be intentionally omitted, so use the center of the full
    # chord-tone evidence instead of requiring every core pitch to be loud.
    guide_anchor = (core_values[1] + core_values[2]) / 2 if len(core_values) >= 4 else max(core_values, default=0.0)
    background = sorted(max(0.0, float(value)) for index, value in enumerate(strengths) if index not in core_pcs)
    noise_floor = background[max(0, len(background) // 3 - 1)] if background else 0.0
    threshold = max(0.055, guide_anchor * 0.46, noise_floor * 1.55)
    presence = persistence if persistence is not None and len(persistence) == 12 else [1.0] * 12

    accepted: list[tuple[int, str, float]] = []
    for interval, label in candidates:
        pc = (root_pc + interval) % 12
        energy = max(0.0, float(strengths[pc]))
        if energy >= threshold and float(presence[pc]) >= 0.46:
            accepted.append((interval, label, energy))

    # Prefer one clearly supported spelling within altered ninth and thirteenth
    # families. This avoids contradictory labels caused by melody spill.
    selected: list[tuple[int, str, float]] = []
    families = ((1, 2, 3), (6,), (8, 9)) if suffix == "7" else tuple((interval,) for interval, _ in candidates)
    for family in families:
        matches = [candidate for candidate in accepted if candidate[0] in family]
        if matches:
            selected.append(max(matches, key=lambda candidate: candidate[2]))
    if not selected:
        return normalized
    labels = "".join(label for _, label, _ in sorted(selected, key=lambda candidate: candidate[0]))
    return f"{root}{suffix}{labels}"


_CHORD_TEMPLATES: tuple[tuple[str, tuple[int, ...]], ...] = (
    ("maj7", (0, 4, 7, 11)), ("m7", (0, 3, 7, 10)), ("7", (0, 4, 7, 10)),
    ("m7♭5", (0, 3, 6, 10)), ("dim7", (0, 3, 6, 9)),
    ("m", (0, 3, 7)), ("", (0, 4, 7)), ("dim", (0, 3, 6)),
    ("sus2", (0, 2, 7)), ("sus4", (0, 5, 7)),
)


def _display_pitch(pitch_class: int, key_hint: dict[str, str] | None = None) -> str:
    key = str((key_hint or {}).get("key") or "")
    sharp_key = "♯" in key or key in {"G", "D", "A", "E", "B"}
    return (_SHARP_NAMES if sharp_key else _PREFERRED_NAMES)[pitch_class % 12]


def _template_for_symbol(symbol: str) -> tuple[int, tuple[int, ...]] | None:
    main = normalize_chord_symbol(symbol).split("/")[0]
    match = re.match(r"^([A-G](?:[♯♭])?)(.*)$", main)
    if not match or match.group(1) not in _PITCH_CLASSES:
        return None
    root_pc = _PITCH_CLASSES[match.group(1)]
    suffix = match.group(2)
    if suffix.startswith("m7♭5"):
        intervals = (0, 3, 6, 10)
    elif suffix.startswith("dim7"):
        intervals = (0, 3, 6, 9)
    elif suffix.startswith("maj"):
        intervals = (0, 4, 7, 11) if re.search(r"7|9|11|13", suffix) else (0, 4, 7)
    elif suffix.startswith("m"):
        intervals = (0, 3, 7, 10) if re.search(r"7|9|11|13", suffix) else (0, 3, 7)
    elif suffix.startswith("dim"):
        intervals = (0, 3, 6)
    elif suffix.startswith("sus2"):
        intervals = (0, 2, 7)
    elif suffix.startswith("sus"):
        intervals = (0, 5, 7)
    elif re.search(r"7|9|11|13", suffix):
        intervals = (0, 4, 7, 10)
    else:
        intervals = (0, 4, 7)
    return root_pc, intervals


def _template_score(
    root_pc: int,
    intervals: tuple[int, ...],
    strengths: list[float],
    persistence: list[float],
    bass_pc: int | None,
) -> float:
    pitch_classes = [(root_pc + interval) % 12 for interval in intervals]
    energy = sum(max(0.0, float(strengths[pc])) for pc in pitch_classes) / len(pitch_classes)
    lasting = sum(max(0.0, float(persistence[pc])) for pc in pitch_classes) / len(pitch_classes)
    required = pitch_classes[:2] + ([pitch_classes[-1]] if len(pitch_classes) == 4 else [])
    missing = sum(1 for pc in required if persistence[pc] < 0.28 and not (pc == root_pc and bass_pc == root_pc))
    bass_bonus = 0.09 if bass_pc == root_pc else 0.035 if bass_pc in pitch_classes else 0.0
    return max(0.0, min(1.0, energy * 0.62 + lasting * 0.31 + bass_bonus - missing * 0.12))


def build_audio_candidates(
    symbol: str,
    strengths: list[float],
    persistence: list[float],
    bass_pc: int | None,
    key_hint: dict[str, str],
) -> tuple[float, list[str], list[dict[str, Any]]]:
    """Build a small, audio-bounded candidate set for the later reviewer."""
    original = normalize_chord_symbol(symbol)
    parsed = _template_for_symbol(original)
    original_score = _template_score(parsed[0], parsed[1], strengths, persistence, bass_pc) if parsed else 0.5
    ranked: list[tuple[float, str]] = [(original_score, original)]
    bass_name = _display_pitch(bass_pc, key_hint) if bass_pc is not None else None
    for root_pc in range(12):
        for suffix, intervals in _CHORD_TEMPLATES:
            score = _template_score(root_pc, intervals, strengths, persistence, bass_pc)
            if score < max(0.43, original_score - 0.16):
                continue
            candidate = f"{_display_pitch(root_pc, key_hint)}{suffix}"
            if bass_pc is not None and bass_pc != root_pc and bass_pc in {(root_pc + interval) % 12 for interval in intervals}:
                candidate = f"{candidate}/{bass_name}"
            ranked.append((score, candidate))
    deduplicated: dict[str, float] = {}
    for score, candidate in ranked:
        deduplicated[candidate] = max(score, deduplicated.get(candidate, 0.0))
    # Keep the original first, then the strongest distinct audio readings.
    alternatives = sorted(
        ((candidate, score) for candidate, score in deduplicated.items() if candidate != original),
        key=lambda item: item[1], reverse=True,
    )[:4]
    scored = [{"chord": original, "score": round(original_score, 3)}] + [
        {"chord": candidate, "score": round(score, 3)} for candidate, score in alternatives
    ]
    confidence = max(0.18, min(0.96, 0.22 + original_score * 0.78))
    return round(confidence, 3), [candidate for candidate, _ in alternatives], scored


def _bass_evidence(cqt_segment: Any) -> tuple[int | None, float]:
    """Find a persistent low-register pitch without folding upper notes into it."""
    import numpy as np

    if cqt_segment is None or cqt_segment.shape[0] < 24 or cqt_segment.shape[1] < 3:
        return None, 0.0
    low = cqt_segment[:24, :]
    energy = np.median(low, axis=1)
    best = int(np.argmax(energy))
    values = np.sort(energy)
    strongest = float(values[-1])
    second = float(values[-2]) if len(values) > 1 else 0.0
    confidence = strongest / max(strongest + second, 1e-8)
    return (best % 12, confidence) if strongest > 1e-8 and confidence >= 0.52 else (None, confidence)


def _register_chroma_evidence(cqt_segment: Any, start_bin: int, end_bin: int | None) -> tuple[list[float], list[float]] | None:
    """Aggregate one register without allowing another register to dominate it."""
    import numpy as np

    if cqt_segment is None or cqt_segment.shape[0] <= start_bin or cqt_segment.shape[1] < 3:
        return None
    upper = cqt_segment[start_bin:end_bin, :]
    if upper.shape[0] < 1:
        return None
    per_pitch = np.zeros((12, upper.shape[1]), dtype=float)
    for bin_index in range(upper.shape[0]):
        pitch_class = (start_bin + bin_index) % 12
        per_pitch[pitch_class] = np.maximum(per_pitch[pitch_class], upper[bin_index])
    frame_peaks = np.maximum(np.max(per_pitch, axis=0), 1e-8)
    relative = per_pitch / frame_peaks
    return np.median(relative, axis=1).tolist(), np.mean(relative >= 0.38, axis=1).tolist()


def _upper_chroma_evidence(cqt_segment: Any) -> tuple[list[float], list[float]] | None:
    """Compatibility helper for callers that need all non-bass registers."""
    return _register_chroma_evidence(cqt_segment, 24, None)


def _detected_note_names(
    strengths: list[float],
    persistence: list[float],
    key_hint: dict[str, str],
) -> list[str]:
    floor = max(0.07, sorted(max(0.0, float(value)) for value in strengths)[5] * 1.18)
    return [
        _display_pitch(pitch_class, key_hint)
        for pitch_class in range(12)
        if strengths[pitch_class] >= floor and persistence[pitch_class] >= 0.44
    ]


def restore_audible_extensions(source: Path, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Restore seventh chords and extensions simplified by the base model."""
    if not events:
        return events
    try:
        import librosa
        import numpy as np

        audio, sample_rate = librosa.load(str(source), sr=22050, mono=True)
        if not len(audio):
            return events
        hop_length = 2048
        chroma = librosa.feature.chroma_stft(
            y=audio, sr=sample_rate, n_fft=4096, hop_length=hop_length, norm=2,
        )
        frame_times = librosa.frames_to_time(
            np.arange(chroma.shape[1]), sr=sample_rate, hop_length=hop_length,
        )
        try:
            cqt = np.abs(librosa.cqt(
                y=audio, sr=sample_rate, hop_length=hop_length,
                fmin=librosa.note_to_hz("C1"), n_bins=72, bins_per_octave=12,
            ))
        except Exception:
            cqt = None
        key_hint = infer_key(events)
        restored: list[dict[str, Any]] = []
        for event_index, event in enumerate(events):
            start = float(event.get("startTime") or 0)
            end = float(event.get("endTime") or start)
            duration = max(0.0, end - start)
            inset = min(0.18, duration * 0.1)
            indices = np.flatnonzero((frame_times >= start + inset) & (frame_times <= end - inset))
            if len(indices) < 4:
                restored.append(event)
                continue
            segment = chroma[:, indices]
            strengths = np.median(segment, axis=1).tolist()
            frame_peaks = np.maximum(np.max(segment, axis=0), 1e-8)
            relative = segment / frame_peaks
            persistence = np.mean(relative >= 0.42, axis=1).tolist()
            cqt_indices = indices[indices < cqt.shape[1]] if cqt is not None else []
            cqt_segment = cqt[:, cqt_indices] if cqt is not None and len(cqt_indices) else None
            bass_pc, bass_confidence = _bass_evidence(cqt_segment)
            # C3-B4 is accompaniment authority. C5 and above is kept as melody
            # evidence but cannot create a chord or extension on its own.
            accompaniment_evidence = _register_chroma_evidence(cqt_segment, 24, 48)
            melody_evidence = _register_chroma_evidence(cqt_segment, 48, None)
            upper_strengths, upper_persistence = accompaniment_evidence or (strengths, persistence)
            melody_strengths, melody_persistence = melody_evidence or ([0.0] * 12, [0.0] * 12)
            base_symbol = str(event.get("chordSymbol") or "?")
            seventh_symbol = infer_seventh_symbol(
                base_symbol,
                upper_strengths,
                upper_persistence,
                key_hint,
                str(events[event_index + 1].get("chordSymbol") or "") if event_index + 1 < len(events) else None,
            )
            completed_symbol = infer_extension_symbol(seventh_symbol, upper_strengths, upper_persistence)
            confidence, alternatives, candidate_scores = build_audio_candidates(
                completed_symbol, upper_strengths, upper_persistence, bass_pc, key_hint,
            )
            restored.append({
                **event,
                "chordSymbol": completed_symbol,
                "originalChord": completed_symbol,
                "confidenceScore": confidence,
                "bassNote": _display_pitch(bass_pc, key_hint) if bass_pc is not None else None,
                "bassConfidence": round(float(bass_confidence), 3),
                "detectedNotes": _detected_note_names(upper_strengths, upper_persistence, key_hint),
                "accompanimentNotes": _detected_note_names(upper_strengths, upper_persistence, key_hint),
                "melodyNotes": _detected_note_names(melody_strengths, melody_persistence, key_hint),
                "alternateCandidates": alternatives,
                "candidateScores": candidate_scores,
            })
        return restored
    except Exception:
        # Extension recovery is additive. A spectral-analysis issue must never
        # discard otherwise usable chord and beat recognition.
        return events


def recognize_chords(source: Path, work_dir: Path) -> list[dict[str, Any]]:
    """Run a locally installed ChordMini-compatible recognizer on the source."""
    chordmini_home = Path(os.environ.get("CHORD_RECOGNIZER_HOME", "/opt/chordmini")).expanduser()
    checkpoint = os.environ.get("CHORD_RECOGNIZER_CHECKPOINT", str(chordmini_home / "checkpoints/2e1d_model_best.pth"))
    if not chordmini_home.is_dir() or not checkpoint:
        raise RuntimeError("A chord recognizer home and approved checkpoint are required.")
    output_dir = work_dir / "recognition"
    output_dir.mkdir()
    command = [
        os.environ.get("PYTHON", "python3"), "src/evaluation/test.py",
        "--model_type", os.environ.get("CHORD_RECOGNIZER_MODEL", "ChordNet"),
        "--checkpoint", checkpoint,
        "--config", os.environ.get("CHORD_RECOGNIZER_CONFIG", "config/ChordMini.yaml"),
        "--audio_dir", str(source), "--save_dir", str(output_dir),
        "--use_overlap", "--use_gaussian", "--kernel_size", "9",
        "--vote_aggregation", "logit", "--min_segment_duration", "0.5", "--smooth_predictions",
    ]
    timeout_seconds = int(os.environ.get("CHORD_RECOGNIZER_TIMEOUT_SECONDS", "1200"))
    subprocess.run(command, cwd=chordmini_home, check=True, timeout=timeout_seconds, capture_output=True, text=True)
    candidates = list(output_dir.rglob("*.lab"))
    if not candidates:
        raise RuntimeError("Chord recognition completed without a timestamped chord chart.")
    return restore_audible_extensions(source, _parse_lab(candidates[0]))


def separate_instrumental(source: Path, work_dir: Path) -> Path:
    """Create a temporary instrumental stem before music analysis.

    Chord recognition on a vocal-heavy mix is easily distracted by a singer's
    melody.  The separator uses a UVR-derived two-stem model and writes both
    stems inside this job's temporary directory.  Only the instrumental stem
    is passed into beat and chord analysis; neither stem leaves this worker.
    """
    # Direct chord recognition is the production default. Running a separator
    # immediately before ChordMini can exhaust a small CPU worker's memory and
    # prevent the recognizer from loading its checkpoint.
    if os.environ.get("SKIP_VOCAL_SEPARATION", "true").lower() == "true":
        return source

    try:
        try:
            from audio_separator.separator import Separator
        except ImportError:
            from audio_separator import Separator
    except ImportError as error:
        raise AnalysisStageError("Instrumental separation is unavailable.") from error

    output_dir = work_dir / "instrumental"
    output_dir.mkdir()
    model_dir = Path(os.environ.get("VOCAL_SEPARATOR_MODEL_DIR", "/var/cache/faithful-keys-models"))
    model_dir.mkdir(parents=True, exist_ok=True)
    model = os.environ.get("VOCAL_SEPARATOR_MODEL", "UVR_MDXNET_KARA_2").removesuffix(".onnx")
    try:
        parameters = inspect.signature(Separator.__init__).parameters
        if "audio_file_path" in parameters:
            separator = Separator(
                str(source),
                model_name=model,
                output_dir=str(output_dir),
                model_file_dir=str(model_dir),
                log_level=logging.WARNING,
            )
            separated = separator.separate()
        else:
            separator = Separator(
                output_dir=str(output_dir),
                model_file_dir=str(model_dir),
                log_level=logging.WARNING,
            )
            model_filename = model if Path(model).suffix else f"{model}.onnx"
            separator.load_model(model_filename=model_filename)
            separated = separator.separate(str(source))
        output_files = [Path(path) for path in separated]
    except Exception as error:
        raise AnalysisStageError("Instrumental separation could not be completed.") from error

    # The package preserves stem intent in the result name.  Prefer the
    # instrumental/accompaniment stem and never accidentally analyze vocals.
    instrumental_markers = ("instrumental", "no_vocals", "karaoke", "accompaniment")
    for candidate in output_files:
        if not candidate.is_absolute():
            candidate = output_dir / candidate
        if candidate.is_file() and any(marker in candidate.name.lower() for marker in instrumental_markers):
            return candidate
    raise AnalysisStageError("Instrumental separation did not return a usable music stem.")


def beat_grid(source: Path, tempo_hint: float | None = None) -> dict[str, Any]:
    """Build a beat grid from audio, honoring a user-selected tempo.

    With a tempo hint, the tracker may locate the performance's first beat but
    cannot change the beat rate. The returned grid is mathematically even, so
    small tracker fluctuations cannot make a chart's rhythm feel irregular.
    """
    import librosa
    import scipy.signal

    # ChordMini's deployed librosa 0.10 stack still calls this former SciPy
    # top-level alias. Current SciPy keeps the implementation in `windows`.
    if not hasattr(scipy.signal, "hann"):
        scipy.signal.hann = scipy.signal.windows.hann

    audio, sample_rate = librosa.load(str(source), sr=None, mono=True)
    # librosa 0.10 calls a SciPy window alias that was removed when its default
    # edge-beat trimmer is enabled. Disabling only that trimmer preserves the
    # actual beat tracker and works with both the deployed and current stacks.
    selected_tempo: float | None = None
    try:
        candidate = float(tempo_hint) if tempo_hint is not None else 0.0
        if 10.0 <= candidate <= 250.0:
            selected_tempo = candidate
    except (TypeError, ValueError):
        selected_tempo = None

    if selected_tempo is not None:
        _, frames = librosa.beat.beat_track(
            y=audio, sr=sample_rate, trim=False, bpm=selected_tempo,
        )
        detected_times = librosa.frames_to_time(frames, sr=sample_rate).tolist()
        first_beat = max(0.0, float(detected_times[0])) if detected_times else 0.0
        seconds_per_beat = 60.0 / selected_tempo
        duration = len(audio) / float(sample_rate)
        grid_size = max(1, int(max(0.0, duration - first_beat) / seconds_per_beat) + 2)
        beat_times = [first_beat + index * seconds_per_beat for index in range(grid_size)]
        return {
            "bpm": round(selected_tempo, 1),
            "beatTimes": [round(float(item), 4) for item in beat_times],
            "tempoSource": "chart",
        }

    tempo, frames = librosa.beat.beat_track(y=audio, sr=sample_rate, trim=False)
    beat_times = librosa.frames_to_time(frames, sr=sample_rate).tolist()
    try:
        tempo_value = float(tempo[0])
    except (IndexError, TypeError):
        tempo_value = float(tempo)
    if tempo_value <= 0:
        tempo_value = 72.0
    while tempo_value < 10:
        tempo_value *= 2
    while tempo_value > 250:
        tempo_value /= 2
    # Very sparse or beatless intros can yield a useful tempo estimate without
    # any tracker frames. Keep the editable chart usable with that tempo grid.
    if not beat_times:
        duration = len(audio) / float(sample_rate)
        seconds_per_beat = 60.0 / tempo_value
        beat_times = [index * seconds_per_beat for index in range(int(duration / seconds_per_beat) + 1)]
    return {
        "bpm": round(tempo_value, 1),
        "beatTimes": [round(float(item), 4) for item in beat_times],
        "tempoSource": "audio",
    }


def rhythm_landmarks(
    source: Path,
    beat_times: list[float],
    bpm: float,
    swing_percent: float = 50,
) -> list[dict[str, Any]]:
    """Measure accompaniment changes, activity, and releases on an eighth grid.

    This extractor deliberately emits no pitch classes or chord labels. It
    combines harmonic spectral change with softened onset energy so vocals and
    drum transients cannot rewrite the uploaded chart's harmony.
    """
    try:
        import librosa
        import numpy as np

        audio, sample_rate = librosa.load(str(source), sr=22050, mono=True)
        if not len(audio):
            return []
        hop_length = 512
        harmonic = librosa.effects.harmonic(audio, margin=3.0)
        onset = np.asarray(librosa.onset.onset_strength(
            y=harmonic, sr=sample_rate, hop_length=hop_length, aggregate=np.median,
        ), dtype=float)
        chroma = np.asarray(librosa.feature.chroma_stft(
            y=harmonic, sr=sample_rate, n_fft=4096, hop_length=hop_length, norm=2,
        ), dtype=float)
        chroma /= np.maximum(np.linalg.norm(chroma, axis=0, keepdims=True), 1e-8)
        change = np.concatenate(([0.0], np.linalg.norm(np.diff(chroma, axis=1), axis=0)))
        rms = np.asarray(librosa.feature.rms(
            y=harmonic, frame_length=2048, hop_length=hop_length,
        )[0], dtype=float)
        frame_count = min(len(onset), len(change), len(rms))
        if frame_count < 2:
            return []
        onset, change, rms = onset[:frame_count], change[:frame_count], rms[:frame_count]
        frame_times = np.asarray(librosa.frames_to_time(
            np.arange(frame_count), sr=sample_rate, hop_length=hop_length,
        ), dtype=float)

        def normalized(values: Any) -> Any:
            values = np.asarray(values, dtype=float)
            lower = float(np.percentile(values, 20))
            upper = float(np.percentile(values, 92))
            if upper <= lower + 1e-9:
                return np.zeros_like(values)
            return np.clip((values - lower) / (upper - lower), 0.0, 1.0)

        novelty = np.clip(normalized(change) * .72 + normalized(onset) * .28, 0.0, 1.0)
        activity_frames = normalized(rms)
        seconds_per_beat = 60.0 / max(10.0, min(250.0, float(bpm or 72)))
        detected_beats = [float(value) for value in beat_times]
        half_beat_count = max(1, (len(detected_beats) - 1) * 2 + 1)
        if not detected_beats:
            duration = len(audio) / float(sample_rate)
            half_beat_count = max(1, int(duration / (seconds_per_beat / 2)) + 1)

        def boundary_time(half_index: int) -> float:
            logical = half_index / 2
            whole = int(logical // 1)
            fraction = logical - whole
            swing = max(50.0, min(75.0, float(swing_percent or 50))) / 100.0
            swung = whole + (fraction * 2 * swing if fraction <= .5 else swing + (fraction - .5) * 2 * (1 - swing))
            lower = int(swung // 1)
            remainder = swung - lower
            if detected_beats and lower + 1 < len(detected_beats):
                return detected_beats[lower] + (detected_beats[lower + 1] - detected_beats[lower]) * remainder
            if detected_beats:
                return detected_beats[-1] + (swung - len(detected_beats) + 1) * seconds_per_beat
            return swung * seconds_per_beat

        boundary_times = [boundary_time(index) for index in range(half_beat_count)]
        window = max(.035, min(.14, seconds_per_beat * .22))
        onset_strengths: list[float] = []
        activities: list[float] = []
        for index, timestamp in enumerate(boundary_times):
            local = np.flatnonzero(np.abs(frame_times - timestamp) <= window)
            onset_strengths.append(float(np.max(novelty[local])) if len(local) else 0.0)
            interval_end = boundary_times[index + 1] if index + 1 < len(boundary_times) else timestamp + seconds_per_beat / 2
            interval = np.flatnonzero((frame_times >= timestamp + window * .25) & (frame_times < interval_end))
            activities.append(float(np.median(activity_frames[interval])) if len(interval) else 0.0)
        if onset_strengths:
            onset_strengths[0] = max(onset_strengths[0], activities[0])

        landmarks: list[dict[str, Any]] = []
        for index, timestamp in enumerate(boundary_times):
            previous_activity = activities[index - 1] if index else activities[index]
            release = max(0.0, min(1.0, (previous_activity - activities[index]) * 1.9))
            landmarks.append({
                "halfBeatIndex": index,
                "time": round(timestamp, 4),
                "onsetStrength": round(onset_strengths[index], 3),
                "activity": round(activities[index], 3),
                "releaseStrength": round(release, 3),
            })
        return landmarks
    except Exception:
        # The fixed chart grid remains a safe fallback if spectral phrasing
        # evidence cannot be calculated for a particular upload.
        return []


def review_harmony(
    candidates: list[dict[str, Any]],
    *,
    key_hint: dict[str, str],
    bpm: float,
    beat_times: list[float],
    learning_examples: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Review a completed chart using only its supplied audio candidates."""
    completed = [{
        **event,
        "originalChord": str(event.get("originalChord") or event.get("chordSymbol") or "?"),
        "confidenceScore": float(event.get("confidenceScore") or 0.5),
        "alternateCandidates": list(event.get("alternateCandidates") or []),
        "candidateScores": list(event.get("candidateScores") or [{
            "chord": str(event.get("originalChord") or event.get("chordSymbol") or "?"),
            "score": float(event.get("confidenceScore") or 0.5),
        }]),
        "detectedNotes": list(event.get("detectedNotes") or []),
    } for event in candidates]
    return review_completed_chart(
        completed,
        key=key_hint["key"],
        mode=key_hint["mode"],
        bpm=bpm,
        beat_times=beat_times,
        learning_examples=learning_examples or [],
    )


def run_analysis(request: AnalysisInput) -> dict[str, Any]:
    """Return chart metadata only and erase the source copy on every path."""
    if not request.source_path.is_file():
        raise ValueError("The secure source object is unavailable.")
    with tempfile.TemporaryDirectory(prefix=f"faithful-keys-{request.job_id}-") as temp:
        work_dir = Path(temp)
        # Copy into an isolated per-job directory; never write input to a shared
        # path or return it in this API response.
        source = work_dir / f"source{request.source_path.suffix.lower()}"
        shutil.copy2(request.source_path, source)
        instrumental = separate_instrumental(source, work_dir)
        reference = request.reference_chart if isinstance(request.reference_chart, dict) else None
        try:
            grid = beat_grid(instrumental, tempo_hint=reference.get("bpm") if reference else None)
        except Exception as error:
            raise AnalysisStageError("Beat detection could not be completed.") from error
        if reference:
            # Chart-first jobs are rhythm-only. Do not run pitch/chord analysis:
            # the performance contributes a beat grid and nothing harmonic can
            # enter, extend, invert, or replace the uploaded chart.
            key = {
                "key": str(reference.get("key") or "C"),
                "mode": str(reference.get("mode") or "major"),
            }
            phrasing = rhythm_landmarks(
                instrumental,
                grid["beatTimes"],
                grid["bpm"],
                float(reference.get("swingPercent") or 50),
            )
            events = align_chart_to_audio(reference, phrasing, grid["beatTimes"], grid["bpm"])
            review = {
                "status": "completed",
                "provider": "chart-timing",
                "model": None,
                "reviewedEvents": len(events),
            }
        else:
            try:
                raw_events = recognize_chords(instrumental, work_dir)
            except Exception as error:
                raise AnalysisStageError("Chord recognition could not be completed.") from error
            key = infer_key(raw_events)
            events, review = review_harmony(
                raw_events,
                key_hint=key,
                bpm=grid["bpm"],
                beat_times=grid["beatTimes"],
                learning_examples=list(request.learning_examples),
            )
        return {
            "jobId": request.job_id,
            "title": request.title or "Untitled song",
            "bpm": grid["bpm"],
            "beatTimes": grid["beatTimes"],
            "timeSignature": "4/4",
            "key": key["key"],
            "mode": key["mode"],
            "confidence": "medium",
            "events": events,
            "review": review,
            "chartFirst": bool(reference),
            "timingOnly": bool(reference),
            "processing": {
                "vocalRemoval": "instrumental-stem" if instrumental != source else "disabled",
                "tempoSource": grid.get("tempoSource", "audio"),
                "rhythmPhrasing": "harmonic-onset-v2" if reference and phrasing else "fixed-grid-fallback" if reference else "recognizer-segments",
                "sourceRetained": False,
            },
        }
