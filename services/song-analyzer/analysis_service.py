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


_PITCH_CLASSES = {"C": 0, "B♯": 0, "C♯": 1, "D♭": 1, "D": 2, "D♯": 3, "E♭": 3, "E": 4, "F♭": 4, "E♯": 5, "F": 5, "F♯": 6, "G♭": 6, "G": 7, "G♯": 8, "A♭": 8, "A": 9, "A♯": 10, "B♭": 10, "B": 11, "C♭": 11}
_PREFERRED_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"]


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
            events.append({"startTime": start, "endTime": end, "chordSymbol": chord, "confidence": "medium"})
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
    return _parse_lab(candidates[0])


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


def beat_grid(source: Path) -> dict[str, Any]:
    """Estimate a beat grid from the permitted temporary source file."""
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
    tempo, frames = librosa.beat.beat_track(y=audio, sr=sample_rate, trim=False)
    beat_times = librosa.frames_to_time(frames, sr=sample_rate).tolist()
    try:
        tempo_value = float(tempo[0])
    except (IndexError, TypeError):
        tempo_value = float(tempo)
    if tempo_value <= 0:
        tempo_value = 72.0
    while tempo_value < 30:
        tempo_value *= 2
    while tempo_value > 200:
        tempo_value /= 2
    # Very sparse or beatless intros can yield a useful tempo estimate without
    # any tracker frames. Keep the editable chart usable with that tempo grid.
    if not beat_times:
        duration = len(audio) / float(sample_rate)
        seconds_per_beat = 60.0 / tempo_value
        beat_times = [index * seconds_per_beat for index in range(int(duration / seconds_per_beat) + 1)]
    return {"bpm": round(tempo_value, 1), "beatTimes": [round(float(item), 4) for item in beat_times]}


def review_harmony(candidates: list[dict[str, Any]], key_hint: str | None) -> list[dict[str, Any]]:
    """Optional constrained reviewer hook.

    A deployed reviewer may choose between candidate symbols using timing and
    harmonic context. It receives no source/stem media and must return JSON
    decisions only; chain-of-thought, lyrics, and raw provider text are never
    persisted or surfaced.
    """
    # The deterministic baseline deliberately preserves recognizer output. An
    # authenticated implementation can replace this with a structured JSON API.
    _ = key_hint
    return candidates


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
        try:
            grid = beat_grid(instrumental)
        except Exception as error:
            raise AnalysisStageError("Beat detection could not be completed.") from error
        try:
            raw_events = recognize_chords(instrumental, work_dir)
        except Exception as error:
            raise AnalysisStageError("Chord recognition could not be completed.") from error
        events = review_harmony(raw_events, key_hint=None)
        key = infer_key(events)
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
            "processing": {
                "vocalRemoval": "instrumental-stem" if instrumental != source else "disabled",
                "sourceRetained": False,
            },
        }
