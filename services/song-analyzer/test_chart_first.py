import unittest

from chart_first import align_chart_to_audio, chord_distance, flatten_reference_chart


class ChartFirstTests(unittest.TestCase):
    def setUp(self):
        self.chart = {
            "key": "C", "mode": "major", "timeSignature": "4/4",
            "sections": [{"name": "Verse", "measures": [
                {"number": 1, "beats": 4, "chordEvents": [
                    {"id": "c1", "chartChord": "Cmaj7", "beat": 1},
                    {"id": "c2", "chartChord": "Dm7", "beat": 3},
                ]},
                {"number": 2, "beats": 4, "chordEvents": [
                    {"id": "c3", "chartChord": "G7", "beat": 1, "locked": True},
                    {"id": "c4", "chartChord": "Cmaj7", "beat": 3},
                ]},
            ]}],
        }

    def test_reference_order_is_preserved(self):
        self.assertEqual([event["chartChord"] for event in flatten_reference_chart(self.chart)], ["Cmaj7", "Dm7", "G7", "Cmaj7"])

    def test_enharmonic_roots_compare_without_rewriting(self):
        self.assertLess(chord_distance("D♭7", "C♯7"), .1)

    def test_exact_ascii_slash_spelling_survives_alignment(self):
        chart = {
            "key": "Eb", "mode": "major", "timeSignature": "4/4",
            "sections": [{"name": "Verse", "measures": [{
                "number": 1, "beats": 4, "chordEvents": [
                    {"id": "slash", "chartChord": "Bb/Eb", "beat": 1},
                ],
            }]}],
        }
        audio = [{
            "startTime": 0, "endTime": 2, "chordSymbol": "B♭maj7",
            "confidenceScore": .9, "detectedNotes": ["B♭", "D", "F", "A"],
        }]
        event = align_chart_to_audio(chart, audio, [0, .5, 1, 1.5, 2], 120)[0]
        self.assertEqual(event["chartChord"], "Bb/Eb")
        self.assertEqual(event["chordSymbol"], "Bb/Eb")
        self.assertNotIn("possibleExtension", event)
        self.assertNotIn("detectedNotes", event)

    def test_audio_conflict_never_replaces_chart_chord(self):
        audio = [
            {"startTime": 0, "endTime": 2, "chordSymbol": "Cmaj7", "confidenceScore": .9, "detectedNotes": ["C", "E", "G", "B"]},
            {"startTime": 2, "endTime": 4, "chordSymbol": "F", "confidenceScore": .82, "detectedNotes": ["F", "A", "C"]},
            {"startTime": 4, "endTime": 6, "chordSymbol": "G13", "confidenceScore": .88, "detectedNotes": ["B", "F", "E"]},
            {"startTime": 6, "endTime": 8, "chordSymbol": "Cmaj7", "confidenceScore": .91, "detectedNotes": ["C", "E", "G", "B"]},
        ]
        events = align_chart_to_audio(self.chart, audio, [index * .5 for index in range(17)], 120)
        self.assertEqual([event["chordSymbol"] for event in events], ["Cmaj7", "Dm7", "G7", "Cmaj7"])
        self.assertEqual([(event["startTime"], event["endTime"]) for event in events], [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 4.0)])
        self.assertTrue(all("conflictingAudioInterpretation" not in event for event in events))
        self.assertTrue(all("possibleExtension" not in event for event in events))
        self.assertTrue(all("passingChordSuggestion" not in event for event in events))
        self.assertTrue(events[2]["locked"])

    def test_video_detected_chords_have_no_effect_on_results(self):
        hostile_audio = [{
            "startTime": 0, "endTime": 99, "chordSymbol": "F♯13",
            "bassNote": "F♯", "detectedNotes": ["F♯", "A♯", "C♯", "E"],
            "alternateCandidates": ["C7", "D♭7"], "confidenceScore": 1.0,
        }]
        beats = [index * .5 for index in range(17)]
        self.assertEqual(
            align_chart_to_audio(self.chart, hostile_audio, beats, 120),
            align_chart_to_audio(self.chart, [], beats, 120),
        )


if __name__ == "__main__":
    unittest.main()
