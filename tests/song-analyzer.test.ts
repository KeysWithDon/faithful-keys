import assert from "node:assert/strict";
import test from "node:test";
import { songChartToGospelStandard } from "../app/admin-gospel-standards.ts";
import { canStartAnalysis, createPrivateReviewChart, nashvilleNumber, normalizedChart, sectionLoopWindow, transposeSongChart, validateAudioFile, validateYouTubeUrl } from "../app/song-analyzer.ts";

test("song analyzer validates permitted sources and confirmation", () => {
  assert.equal(validateYouTubeUrl("https://youtu.be/abc123").valid, true);
  assert.equal(validateYouTubeUrl("https://example.com/audio.mp3").valid, false);
  assert.equal(validateAudioFile({ name: "song.wav", size: 100, type: "audio/wav" }).valid, true);
  assert.equal(validateAudioFile({ name: "song.exe", size: 100, type: "application/octet-stream" }).valid, false);
  assert.equal(canStartAnalysis("youtube", false, "https://youtu.be/abc123").allowed, false);
});

test("song charts stay editable, timed, and theory-aware", () => {
  const chart = createPrivateReviewChart({ sourceType: "upload", title: "My Song" });
  chart.sections[0].measures[0].chordEvents.push({ id: "one", chordSymbol: "D♭maj7", nashvilleNumber: "", startTime: 0, endTime: 2, measureNumber: 1, beat: 1, confidence: "low", userEdited: true, confirmed: false });
  const normalized = normalizedChart(chart);
  assert.equal(normalized.sections[0].measures[0].beats, 4);
  assert.equal(normalized.sections[0].measures[0].chordEvents[0].nashvilleNumber, "♭2maj7");
  assert.equal(transposeSongChart(normalized, 2).sections[0].measures[0].chordEvents[0].chordSymbol, "D♯maj7");
  assert.deepEqual(sectionLoopWindow(normalized.sections[0]), { start: 0, end: 0 });
  assert.equal(nashvilleNumber("G7", "C"), "57");
});

test("reviewed analyzer charts preserve shared-bar timing when published as Gospel Standards", () => {
  const chart = createPrivateReviewChart({ sourceType: "upload", title: "Admin Gospel Study" });
  chart.artist = "Faithful Keys";
  chart.key = "D♭";
  chart.timeSignature = "6/8";
  chart.sections[0].measures[0].beats = 6;
  chart.sections[0].measures[0].chordEvents.push(
    { id: "one", chordSymbol: "D♭maj7", nashvilleNumber: "1", startTime: 0, endTime: 2, measureNumber: 1, beat: 1, confidence: "high", userEdited: true, confirmed: true },
    { id: "two", chordSymbol: "A♭7", nashvilleNumber: "5", startTime: 2, endTime: 4, measureNumber: 1, beat: 4, confidence: "high", userEdited: true, confirmed: true },
  );
  const standard = songChartToGospelStandard(chart);
  assert.equal(standard.key, "D♭");
  assert.deepEqual(standard.timeSignature, [6, 8]);
  assert.deepEqual(standard.bars[0], { chords: ["D♭maj7", "A♭7"], durations: [3, 3], beats: 6 });
  assert.equal(standard.source, "manual-transcription");
});
