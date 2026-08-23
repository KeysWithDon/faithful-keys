import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from analysis_service import beat_grid, infer_extension_symbol, infer_key, infer_seventh_symbol, normalize_chord_symbol, separate_instrumental


class AnalysisServiceTest(unittest.TestCase):
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
