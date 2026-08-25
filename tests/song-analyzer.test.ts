import assert from "node:assert/strict";
import test from "node:test";
import { gospelStandardToSongChart, songChartToGospelStandard } from "../app/admin-gospel-standards.ts";
import type { StandardChart } from "../app/standards.ts";
import { canStartAnalysis, captureChartHarmony, createPrivateReviewChart, nashvilleNumber, normalizedChart, parseChordChartText, restoreChartHarmony, sectionLoopWindow, transposeChordSymbol, transposeSongChart, validateAudioFile, validateYouTubeUrl } from "../app/song-analyzer.ts";

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

test("chart reader preserves the chart's exact accidental and slash spelling", () => {
  const chart = parseChordChartText(`
[Verse]
| Bb/Eb | B♭/E♭ | F#/C# | F♯/C♯ |
| Bb7b9/Eb | B♭7♭9/E♭ | C6/9 | Fm/maj7 |
  `, { title: "Exact Spelling", fileName: "source-chart.cho" });
  const symbols = chart.sections.flatMap(section => section.measures)
    .flatMap(measure => measure.chordEvents)
    .map(event => event.chordSymbol);
  assert.deepEqual(symbols, ["Bb/Eb", "B♭/E♭", "F#/C#", "F♯/C♯", "Bb7b9/Eb", "B♭7♭9/E♭", "C6/9", "Fm/maj7"]);
  assert.deepEqual(
    chart.sections.flatMap(section => section.measures).flatMap(measure => measure.chordEvents).map(event => event.chartChord),
    symbols,
  );
  chart.key = "E♭";
  const standard = songChartToGospelStandard(chart);
  assert.equal(typeof standard.bars[0] === "string" ? standard.bars[0] : standard.bars[0].chords[0], "B♭/E♭");
});

test("slash chords transpose without corrupting 6/9 or minor-major qualities", () => {
  assert.equal(transposeChordSymbol("B♭7/E♭", 2), "C7/F");
  assert.equal(transposeChordSymbol("C6/9", 2), "D6/9");
  assert.equal(transposeChordSymbol("Fm/maj7", 2), "Gm/maj7");
  assert.equal(nashvilleNumber("G7/B", "C"), "57");
});

test("cloud timing cannot replace or respell the captured chart harmony", () => {
  const source = parseChordChartText(`
[Verse]
| E♭maj7 | B♭7/E♭ |
  `, { title: "Immutable Harmony", fileName: "immutable.cho" });
  source.key = "E♭";
  const captured = captureChartHarmony(source);
  let analyzedEventIndex = 0;
  const analyzed = {
    ...captured,
    key: "D♯",
    sections: captured.sections.map(section => ({ ...section, measures: section.measures.map(measure => ({
      ...measure,
      chordEvents: measure.chordEvents.map(event => {
        const index = analyzedEventIndex++;
        return {
          ...event,
          chordSymbol: index ? "A♯7/D♯" : "D♯maj7",
          chartChord: index ? "A♯7/D♯" : "D♯maj7",
          startTime: index * 2,
          endTime: index * 2 + 2,
        };
      }),
    })) })),
  };
  const restored = restoreChartHarmony(analyzed);
  assert.equal(restored.key, "E♭");
  assert.deepEqual(
    restored.sections.flatMap(section => section.measures).flatMap(measure => measure.chordEvents).map(event => event.chordSymbol),
    ["E♭maj7", "B♭7/E♭"],
  );
  assert.deepEqual(
    restored.sections.flatMap(section => section.measures).flatMap(measure => measure.chordEvents).map(event => [event.startTime, event.endTime]),
    [[0, 2], [2, 4]],
  );
  assert.equal(restored.harmonicAuthority, undefined);
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

test("published Gospel Standards reopen as editable charts and round-trip safely", () => {
  const published: StandardChart = {
    name: "Editable Gospel Study",
    key: "E♭",
    composer: "Faithful Keys",
    style: "Contemporary gospel",
    timeSignature: [6, 8],
    bars: [
      "E♭maj9/G",
      { chords: ["A♭maj7", "B♭13♭9/E♭"], durations: [3, 3], beats: 6 },
    ],
    source: "manual-transcription",
    matchStatus: "manual",
    sourceTitle: "Editable Gospel Study",
    note: "Admin chart",
  };
  const editable = gospelStandardToSongChart(published);
  assert.equal(editable.title, published.name);
  assert.equal(editable.artist, published.composer);
  assert.equal(editable.timeSignature, "6/8");
  assert.equal(editable.publishedStandard?.originalName, published.name);
  assert.equal(editable.publishedStandard?.style, published.style);
  assert.deepEqual(
    editable.sections[0].measures.flatMap(measure => measure.chordEvents.map(event => [event.chordSymbol, event.beat])),
    [["E♭maj9/G", 1], ["A♭maj7", 1], ["B♭13♭9/E♭", 4]],
  );
  assert.deepEqual(songChartToGospelStandard(editable), published);
  editable.title = "Renamed Gospel Study";
  const renamed = songChartToGospelStandard(editable);
  assert.equal(renamed.name, "Renamed Gospel Study");
  assert.equal(renamed.sourceTitle, "Renamed Gospel Study");
  assert.equal(editable.publishedStandard?.originalName, "Editable Gospel Study");
});

test("Gospel Standards are respelled for the key selected in the editor", () => {
  const chart = createPrivateReviewChart({ sourceType: "upload", title: "Enharmonic Gospel Study" });
  chart.key = "E♭";
  chart.sections[0].measures[0].chordEvents.push(
    { id: "one", chordSymbol: "D#maj9", nashvilleNumber: "1", startTime: 0, endTime: 1, measureNumber: 1, beat: 1, confidence: "high", userEdited: true, confirmed: true },
    { id: "two", chordSymbol: "A#m7/D#", nashvilleNumber: "5", startTime: 1, endTime: 2, measureNumber: 1, beat: 2, confidence: "high", userEdited: true, confirmed: true },
    { id: "three", chordSymbol: "G#13b9", nashvilleNumber: "4", startTime: 2, endTime: 4, measureNumber: 1, beat: 3, confidence: "high", userEdited: true, confirmed: true },
  );
  const standard = songChartToGospelStandard(chart);
  assert.deepEqual(standard.bars[0], {
    chords: ["E♭maj9", "B♭m7/E♭", "A♭13♭9"],
    durations: [1, 1, 2],
    beats: 4,
  });
  assert.deepEqual(
    chart.sections[0].measures[0].chordEvents.map(event => event.chordSymbol),
    ["D#maj9", "A#m7/D#", "G#13b9"],
  );
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
