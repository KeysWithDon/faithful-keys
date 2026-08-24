import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import numpy as np

from analysis_service import AnalysisInput, _upper_chroma_evidence, beat_grid, build_audio_candidates, infer_extension_symbol, infer_key, infer_seventh_symbol, normalize_chord_symbol, run_analysis, separate_instrumental
from chord_review import build_review_records, review_completed_chart, validate_review_payload


class AnalysisServiceTest(unittest.TestCase):
    def test_chart_first_job_skips_chord_recognition_and_uses_only_beat_timing(self):
        chart = {
            "key": "E♭", "mode": "major", "timeSignature": "4/4",
            "sections": [{"name": "Verse", "measures": [{
                "number": 1, "beats": 4, "chordEvents": [
                    {"id": "one", "chartChord": "Bb/Eb", "beat": 1},
                    {"id": "two", "chartChord": "A♭maj7", "beat": 3},
                ],
            }]}],
        }
        with TemporaryDirectory() as directory:
            source = Path(directory) / "performance.wav"
            source.write_bytes(b"test-audio")
            request = AnalysisInput(
                job_id="job", user_id="user", source_path=source,
                title="Chart authority", reference_chart=chart,
            )
            with patch("analysis_service.separate_instrumental", side_effect=lambda path, _work: path), patch(
                "analysis_service.beat_grid", return_value={"bpm": 120, "beatTimes": [0, .5, 1, 1.5, 2]},
            ), patch("analysis_service.recognize_chords", side_effect=AssertionError("must not run")):
                result = run_analysis(request)
        self.assertTrue(result["chartFirst"])
        self.assertTrue(result["timingOnly"])
        self.assertEqual(result["review"]["provider"], "chart-timing")
        self.assertEqual([event["chordSymbol"] for event in result["events"]], ["Bb/Eb", "A♭maj7"])
        self.assertTrue(all("detectedNotes" not in event for event in result["events"]))

    def test_beat_grid_disables_incompatible_edge_trimming(self):
        calls = {}

        class Beat:
            @staticmethod
            def beat_track(*, y, sr, trim):
                calls["trim"] = trim
                return 90.0, []

        fake_librosa = types.ModuleType("librosa")
        fake_librosa.load = lambda _path, sr, mono: ([0.0] * 200, 100)
        fake_librosa.beat = Beat()
        fake_librosa.frames_to_time = lambda frames, sr: types.SimpleNamespace(tolist=lambda: [])
        with patch.dict(sys.modules, {"librosa": fake_librosa}):
            result = beat_grid(Path("unused.wav"))
        self.assertFalse(calls["trim"])
        self.assertEqual(result["bpm"], 90.0)
        self.assertEqual(result["beatTimes"], [0.0, 0.6667, 1.3333, 2.0])

    def test_normalizes_recognizer_symbols_without_changing_the_root(self):
        self.assertEqual(normalize_chord_symbol("D♯:min7"), "D♯m7")
        self.assertEqual(normalize_chord_symbol("D♭:maj7"), "D♭maj7")
        self.assertEqual(normalize_chord_symbol("B:min7b5"), "Bm7♭5")
        self.assertEqual(normalize_chord_symbol("C:7"), "C7")

    def test_restores_only_extensions_with_persistent_audio_evidence(self):
        strengths = [0.02] * 12
        persistence = [0.1] * 12
        for pitch_class in (0, 4, 7, 10):
            strengths[pitch_class] = 0.72
            persistence[pitch_class] = 0.9
        strengths[2] = 0.48
        persistence[2] = 0.71
        strengths[9] = 0.44
        persistence[9] = 0.67
        self.assertEqual(infer_extension_symbol("C:7", strengths, persistence), "C7add9add13")

    def test_does_not_guess_extensions_from_short_or_weak_color_tones(self):
        strengths = [0.03] * 12
        persistence = [0.1] * 12
        for pitch_class in (0, 3, 7, 10):
            strengths[pitch_class] = 0.75
            persistence[pitch_class] = 0.9
        strengths[2] = 0.28
        persistence[2] = 0.25
        self.assertEqual(infer_extension_symbol("C:min7", strengths, persistence), "Cm7")

    def test_preserves_extensions_already_supplied_by_the_recognizer(self):
        self.assertEqual(infer_extension_symbol("D♭:maj9", [1.0] * 12, [1.0] * 12), "D♭maj9")

    def test_restores_diatonic_sevenths_only_with_audio_evidence(self):
        strengths = [0.02] * 12
        persistence = [0.1] * 12
        for pitch_class in (2, 5, 9):
            strengths[pitch_class] = 0.74
            persistence[pitch_class] = 0.9
        strengths[0] = 0.42
        persistence[0] = 0.68
        self.assertEqual(
            infer_seventh_symbol("D:min", strengths, persistence, {"key": "C", "mode": "major"}, "G"),
            "Dm7",
        )

    def test_secondary_dominant_motion_prefers_the_audible_flat_seventh(self):
        strengths = [0.02] * 12
        persistence = [0.1] * 12
        for pitch_class in (9, 1, 4):
            strengths[pitch_class] = 0.75
            persistence[pitch_class] = 0.9
        strengths[7] = 0.43
        persistence[7] = 0.66
        self.assertEqual(
            infer_seventh_symbol("A:maj", strengths, persistence, {"key": "C", "mode": "major"}, "D:min"),
            "A7",
        )

    def test_tonic_major_seventh_requires_the_written_leading_tone_to_persist(self):
        strengths = [0.02] * 12
        persistence = [0.1] * 12
        for pitch_class in (0, 4, 7):
            strengths[pitch_class] = 0.76
            persistence[pitch_class] = 0.9
        strengths[11] = 0.44
        persistence[11] = 0.65
        self.assertEqual(
            infer_seventh_symbol("C:maj", strengths, persistence, {"key": "C", "mode": "major"}),
            "Cmaj7",
        )
        persistence[11] = 0.2
        self.assertEqual(
            infer_seventh_symbol("C:maj", strengths, persistence, {"key": "C", "mode": "major"}),
            "C",
        )

    def test_diatonic_leading_tone_uses_half_diminished_seventh(self):
        strengths = [0.02] * 12
        persistence = [0.1] * 12
        for pitch_class in (11, 2, 5):
            strengths[pitch_class] = 0.73
            persistence[pitch_class] = 0.9
        strengths[9] = 0.41
        persistence[9] = 0.64
        self.assertEqual(
            infer_seventh_symbol("B:dim", strengths, persistence, {"key": "C", "mode": "major"}, "C"),
            "Bm7♭5",
        )

    def test_key_suggestion_uses_detected_harmony(self):
        result = infer_key([
            {"chordSymbol": "Cmaj7"}, {"chordSymbol": "Dm7"},
            {"chordSymbol": "G7"}, {"chordSymbol": "Cmaj7"},
        ])
        self.assertEqual(result, {"key": "C", "mode": "major"})

    def test_ambiguous_or_empty_results_keep_a_safe_editable_default(self):
        self.assertEqual(infer_key([]), {"key": "C", "mode": "major"})

    def test_audio_candidates_can_distinguish_an_inversion_from_a_root_position_minor_chord(self):
        strengths = [0.02] * 12
        persistence = [0.08] * 12
        for pitch_class in (0, 4, 7, 11):
            strengths[pitch_class] = 0.78
            persistence[pitch_class] = 0.9
        confidence, alternatives, scores = build_audio_candidates(
            "Em7", strengths, persistence, bass_pc=4, key_hint={"key": "C", "mode": "major"},
        )
        self.assertGreater(confidence, 0.5)
        self.assertIn("Cmaj7/E", alternatives)
        self.assertEqual(scores[0]["chord"], "Em7")

    def test_upper_note_evidence_excludes_the_separately_detected_bass_register(self):
        cqt = np.zeros((36, 6), dtype=float)
        cqt[0, :] = 1.0   # C1 bass
        cqt[28, :] = .8   # E3 upper voice
        strengths, persistence = _upper_chroma_evidence(cqt)
        self.assertEqual(strengths[0], 0.0)
        self.assertGreater(strengths[4], .9)
        self.assertEqual(persistence[4], 1.0)

    def test_review_records_include_chart_position_and_repeated_section_evidence(self):
        events = []
        progression = ["C", "F", "G7", "C", "C", "F", "Am", "C"]
        for index, chord in enumerate(progression):
            events.append({
                "eventId": f"e-{index}", "startTime": index * 2, "endTime": index * 2 + 1.8,
                "chordSymbol": chord, "originalChord": chord, "confidenceScore": .5 if index == 6 else .72,
                "bassNote": chord[0], "detectedNotes": [chord[0]], "alternateCandidates": [],
            })
        records = build_review_records(
            events, key="C", mode="major", bpm=120,
            beat_times=[index * .5 for index in range(40)],
        )
        self.assertEqual(records[0]["measure"], 1)
        self.assertEqual(records[0]["beat"], 1)
        self.assertEqual(records[0]["section"], "Verse")
        self.assertTrue(records[0]["repeatedOccurrences"])
        self.assertEqual(records[2]["repeatedOccurrences"][0]["chord"], "Am")

    def test_strict_review_validation_rejects_an_invented_chord(self):
        record = {
            "eventId": "e-1", "originalChord": "Em7", "alternateCandidates": ["Cmaj7/E"],
            "confidenceScore": .6, "candidateScores": [
                {"chord": "Em7", "score": .6}, {"chord": "Cmaj7/E", "score": .78},
            ],
        }
        payload = {"reviews": [{
            "eventId": "e-1", "originalChord": "Em7", "recommendedChord": "A7",
            "status": "Likely", "confidence": .8, "reason": "It would resolve well.",
            "alternatives": [], "candidateRanking": ["A7"], "needsHumanReview": False,
        }]}
        with self.assertRaises(ValueError):
            validate_review_payload(payload, [record])

    def test_invalid_or_unavailable_ai_keeps_the_completed_chart(self):
        event = {
            "eventId": "e-1", "startTime": 0, "endTime": 2, "chordSymbol": "Em7",
            "originalChord": "Em7", "confidenceScore": .55, "bassNote": "E",
            "detectedNotes": ["E", "G", "B", "D"], "alternateCandidates": ["Cmaj7/E"],
            "candidateScores": [{"chord": "Em7", "score": .55}, {"chord": "Cmaj7/E", "score": .62}],
        }
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}, clear=False), patch(
            "chord_review._request_batch", side_effect=RuntimeError("offline"),
        ):
            reviewed, status = review_completed_chart(
                [event], key="C", mode="major", bpm=90, beat_times=[0, .667, 1.333, 2],
            )
        self.assertEqual(status["status"], "unavailable")
        self.assertEqual(reviewed[0]["chordSymbol"], "Em7")
        self.assertEqual(reviewed[0]["review"]["status"], "Ambiguous")

    def test_valid_ai_review_can_choose_only_a_supplied_candidate(self):
        event = {
            "eventId": "e-1", "startTime": 0, "endTime": 2, "chordSymbol": "Em7",
            "originalChord": "Em7", "confidenceScore": .55, "bassNote": "E",
            "detectedNotes": ["C", "E", "G", "B"], "alternateCandidates": ["Cmaj7/E"],
            "candidateScores": [{"chord": "Em7", "score": .55}, {"chord": "Cmaj7/E", "score": .76}],
        }
        decision = {
            "eventId": "e-1", "originalChord": "Em7", "recommendedChord": "Cmaj7/E",
            "status": "Likely", "confidence": .82,
            "reason": "The bass is E while C, E, G, and B persist above it.",
            "alternatives": ["Em7"], "candidateRanking": ["Cmaj7/E", "Em7"],
            "needsHumanReview": False,
        }
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}, clear=False), patch(
            "chord_review._request_batch", return_value=[decision],
        ):
            reviewed, status = review_completed_chart(
                [event], key="C", mode="major", bpm=90, beat_times=[0, .667, 1.333, 2],
            )
        self.assertEqual(status["status"], "completed")
        self.assertEqual(reviewed[0]["chordSymbol"], "Cmaj7/E")

    def test_no_key_uses_local_audio_evidence_without_inventing_a_chord(self):
        event = {
            "eventId": "e-1", "startTime": 0, "endTime": 2, "chordSymbol": "Em7",
            "originalChord": "Em7", "confidenceScore": .55, "bassNote": "E",
            "detectedNotes": ["C", "E", "G", "B"], "alternateCandidates": ["Cmaj7/E"],
            "candidateScores": [{"chord": "Em7", "score": .55}, {"chord": "Cmaj7/E", "score": .79}],
        }
        with patch.dict("os.environ", {"OPENAI_API_KEY": ""}, clear=False):
            reviewed, status = review_completed_chart(
                [event], key="C", mode="major", bpm=90, beat_times=[0, .667, 1.333, 2],
            )
        self.assertEqual(status["provider"], "local-evidence")
        self.assertEqual(status["status"], "completed")
        self.assertEqual(reviewed[0]["chordSymbol"], "Cmaj7/E")
        self.assertEqual(reviewed[0]["review"]["candidateRanking"], ["Cmaj7/E", "Em7"])
        self.assertIn("detected E", reviewed[0]["review"]["reason"])

    def test_local_reviewer_keeps_close_candidates_ambiguous(self):
        event = {
            "eventId": "e-1", "startTime": 0, "endTime": 2, "chordSymbol": "Em7",
            "originalChord": "Em7", "confidenceScore": .58, "bassNote": "E",
            "detectedNotes": ["E", "G", "B"], "alternateCandidates": ["Cmaj7/E"],
            "candidateScores": [{"chord": "Em7", "score": .58}, {"chord": "Cmaj7/E", "score": .61}],
        }
        with patch.dict("os.environ", {"OPENAI_API_KEY": ""}, clear=False):
            reviewed, status = review_completed_chart(
                [event], key="C", mode="major", bpm=90, beat_times=[0, .667, 1.333, 2],
            )
        self.assertEqual(status["provider"], "local-evidence")
        self.assertEqual(reviewed[0]["chordSymbol"], "Em7")
        self.assertEqual(reviewed[0]["review"]["status"], "Ambiguous")
        self.assertTrue(reviewed[0]["review"]["needsHumanReview"])

    def test_uses_only_the_instrumental_stem_for_analysis(self):
        class FakeSeparator:
            def __init__(self, audio_file_path, *, model_name, output_dir, model_file_dir, log_level):
                self.audio_file_path = audio_file_path
                self.model_name = model_name
                self.output_dir = Path(output_dir)
                self.model_file_dir = model_file_dir
                self.log_level = log_level

            def separate(self):
                (self.output_dir / "track_(Vocals).wav").write_bytes(b"vocals")
                (self.output_dir / "track_(Instrumental).wav").write_bytes(b"music")
                return ["track_(Vocals).wav", "track_(Instrumental).wav"]

        separator_module = types.ModuleType("audio_separator.separator")
        separator_module.Separator = FakeSeparator
        package_module = types.ModuleType("audio_separator")
        with TemporaryDirectory() as temp, patch.dict(sys.modules, {
            "audio_separator": package_module,
            "audio_separator.separator": separator_module,
        }), patch.dict("os.environ", {
            "SKIP_VOCAL_SEPARATION": "false",
            "VOCAL_SEPARATOR_MODEL_DIR": str(Path(temp) / "models"),
        }, clear=False):
            work_dir = Path(temp)
            source = work_dir / "source.wav"
            source.write_bytes(b"mix")
            instrumental = separate_instrumental(source, work_dir)
            self.assertEqual(instrumental.name, "track_(Instrumental).wav")
            self.assertEqual(instrumental.read_bytes(), b"music")

    def test_supports_current_audio_separator_api(self):
        class CurrentSeparator:
            def __init__(self, *, output_dir, model_file_dir, log_level):
                self.output_dir = Path(output_dir)
                self.model_file_dir = model_file_dir
                self.log_level = log_level

            def load_model(self, *, model_filename):
                self.model_filename = model_filename

            def separate(self, audio_file_path):
                self.audio_file_path = audio_file_path
                path = self.output_dir / "track_(Instrumental).wav"
                path.write_bytes(b"music")
                return [str(path)]

        separator_module = types.ModuleType("audio_separator.separator")
        separator_module.Separator = CurrentSeparator
        package_module = types.ModuleType("audio_separator")
        with TemporaryDirectory() as temp, patch.dict(sys.modules, {
            "audio_separator": package_module,
            "audio_separator.separator": separator_module,
        }), patch.dict("os.environ", {
            "SKIP_VOCAL_SEPARATION": "false",
            "VOCAL_SEPARATOR_MODEL_DIR": str(Path(temp) / "models"),
        }, clear=False):
            work_dir = Path(temp)
            source = work_dir / "source.wav"
            source.write_bytes(b"mix")
            instrumental = separate_instrumental(source, work_dir)
            self.assertEqual(instrumental.name, "track_(Instrumental).wav")
            self.assertEqual(instrumental.read_bytes(), b"music")


if __name__ == "__main__":
    unittest.main()
