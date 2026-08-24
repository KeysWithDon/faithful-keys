import assert from "node:assert/strict";
import test from "node:test";
import { songChartToGospelStandard } from "../app/admin-gospel-standards.ts";
import { canStartAnalysis, createPrivateReviewChart, nashvilleNumber, normalizedChart, parseChordChartText, sectionLoopWindow, transposeSongChart, validateAudioFile, validateYouTubeUrl } from "../app/song-analyzer.ts";

test("song analyzer validates permitted sources and confirmation", () => {
  assert.equal(validateYouTubeUrl("https://youtu.be/abc123").valid, true);
  assert.equal(validateYouTubeUrl("https://music.youtube.com/watch?v=abc123").valid, true);
  assert.equal(validateYouTubeUrl("https://www.youtube.com/shorts/abc123").valid, true);
  assert.equal(validateYouTubeUrl("https://example.com/audio.mp3").valid, false);
  assert.equal(validateYouTubeUrl("http://youtube.com/watch?v=abc123").valid, false);
  assert.equal(validateYouTubeUrl("https://youtube.com/channel/abc123").valid, false);
  assert.equal(validateAudioFile({ name: "song.wav", size: 100, type: "audio/wav" }).valid, true);
  assert.equal(validateAudioFile({ name: "performance.mp4", size: 100, type: "video/mp4" }).valid, true);
  assert.equal(validateAudioFile({ name: "song.exe", size: 100, type: "application/octet-stream" }).valid, false);
  assert.equal(canStartAnalysis("youtube", false, "https://youtu.be/abc123").allowed, false);
  assert.equal(canStartAnalysis("upload", true, { name: "song.wav", size: 100, type: "audio/wav" }).allowed, true);
  assert.equal(canStartAnalysis("youtube", true, "https://youtu.be/abc123").allowed, true);
});

test("chart-first import preserves section order and written harmony", () => {
  const chart = parseChordChartText(`
[Intro]
| D♭maj7 | A♭/C |
[Verse]
| B♭m7 E♭7 | A♭maj7 |
  `, { title: "Chart First", fileName: "chart.txt" });
  assert.deepEqual(chart.sections.map(section => section.name), ["Intro", "Verse"]);
  assert.deepEqual(chart.sections.flatMap(section => section.measures).flatMap(measure => measure.chordEvents).map(event => event.chartChord), [
    "D♭maj7", "A♭/C", "B♭m7", "E♭7", "A♭maj7",
  ]);
  assert.equal(chart.chartReference?.chordCount, 5);
});

test("ChordPro melody text does not become chart harmony", () => {
  const chart = parseChordChartText(`
[Verse]
[Cmaj7]Sing a [Am7]new song
[Dm7]passing melody [G7]returns
  `);
  assert.deepEqual(chart.sections[0].measures.flatMap(measure => measure.chordEvents).map(event => event.chordSymbol), ["Cmaj7", "Am7", "Dm7", "G7"]);
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

test("published analyzer songs preserve every recognized extension symbol", () => {
  const chart = createPrivateReviewChart({ sourceType: "upload", title: "Extended Gospel Study" });
  chart.sections[0].measures[0].chordEvents.push(
    { id: "one", chordSymbol: "D♭maj9", nashvilleNumber: "1", startTime: 0, endTime: 1, measureNumber: 1, beat: 1, confidence: "high", userEdited: false, confirmed: false },
    { id: "two", chordSymbol: "E♭m11", nashvilleNumber: "2", startTime: 1, endTime: 2, measureNumber: 1, beat: 2, confidence: "high", userEdited: false, confirmed: false },
    { id: "three", chordSymbol: "A♭13♭9", nashvilleNumber: "5", startTime: 2, endTime: 4, measureNumber: 1, beat: 3, confidence: "high", userEdited: false, confirmed: false },
  );
  const standard = songChartToGospelStandard(chart);
  assert.deepEqual(standard.bars[0], {
    chords: ["D♭maj9", "E♭m11", "A♭13♭9"],
    durations: [1, 1, 2],
    beats: 4,
  });
});
