import assert from "node:assert/strict";
import test from "node:test";
import { gospelStandardToSongChart, songChartToGospelStandard } from "../app/admin-gospel-standards.ts";
import { standardTimeline } from "../app/standard-timeline.ts";
import type { StandardChart } from "../app/standards.ts";
import { analysisProgressPresentation, appendSongMeasure, appendSongSection, beatPositionLabel, canStartAnalysis, captureChartHarmony, chordBankForKey, chordEventAtSlot, createManualSongChart, createPrivateReviewChart, moveChordEvent, nashvilleNumber, normalizedChart, parseChordChartText, pasteChordEvent, pasteSongMeasure, pasteSongSection, reflowManualChart, removeChordEvent, removeEmptySongMeasure, removeSongMeasure, restoreChartHarmony, sectionLoopWindow, swingBeatPosition, transposeChordSymbol, transposeSongChart, validateAudioFile, validateChartFile, validateYouTubeUrl } from "../app/song-analyzer.ts";

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

test("active analysis reports honest elapsed work instead of a fake percentage", () => {
  const createdAt = "2026-08-25T12:00:00.000Z";
  const queued = analysisProgressPresentation({ id: "job", sourceType: "upload", status: "queued", progress: 92, createdAt }, Date.parse(createdAt) + 12_000);
  assert.equal(queued.indeterminate, true);
  assert.equal(queued.percent, null);
  assert.match(queued.detail, /12s/);
  const processing = analysisProgressPresentation({ id: "job", sourceType: "upload", status: "processing", progress: 92, createdAt }, Date.parse(createdAt) + 125_000);
  assert.equal(processing.indeterminate, true);
  assert.equal(processing.percent, null);
  assert.match(processing.detail, /2m 05s/);
  const completed = analysisProgressPresentation({ id: "job", sourceType: "upload", status: "completed", progress: 100, createdAt }, Date.parse(createdAt) + 130_000);
  assert.equal(completed.indeterminate, false);
  assert.equal(completed.percent, 100);
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

test("chart import supports beat-and placements and swing math", () => {
  const chart = parseChordChartText("[Verse]\n| C7 Dm7 E7 F7 G7 Am7 Bdim7 Cmaj7 |");
  assert.deepEqual(chart.sections[0].measures[0].chordEvents.map(event => event.beat), [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]);
  assert.equal(beatPositionLabel(3.5), "3 &");
  assert.equal(swingBeatPosition(.5, 50), .5);
  assert.equal(swingBeatPosition(.5, 67), .67);
  assert.equal(swingBeatPosition(1, 67), 1);
});

test("admin can start a blank chart, add bars and sections, and remove bars safely", () => {
  const chart = createManualSongChart({ title: "My custom song", artist: "Faithful Keys", key: "E♭", bpm: 120, timeSignature: "6/8", sectionName: "Intro", bars: 2 });
  assert.equal(chart.manual, true);
  assert.equal(chart.title, "My custom song");
  assert.equal(chart.sections[0].name, "Intro");
  assert.equal(chart.sections[0].measures.length, 2);
  assert.ok(chart.sections[0].measures.every(measure => measure.beats === 6 && measure.chordEvents.length === 0));
  assert.deepEqual(chart.sections[0].measures.map(measure => measure.startTime), [0, 3]);

  const withBar = appendSongMeasure(chart, 0);
  assert.equal(withBar.sections[0].measures.length, 3);
  assert.deepEqual(withBar.sections[0].measures.map(measure => [measure.number, measure.startTime]), [[1, 0], [2, 3], [3, 6]]);

  const withSection = appendSongSection(withBar, "Chorus", 2);
  assert.deepEqual(withSection.sections.map(section => [section.name, section.measures.length]), [["Intro", 3], ["Chorus", 2]]);
  assert.equal(withSection.sections[1].startTime, 9);

  const removed = removeEmptySongMeasure(withSection, 0, 1);
  assert.deepEqual(removed.sections[0].measures.map(measure => [measure.number, measure.startTime]), [[1, 0], [2, 3]]);

  const populated = { ...removed, sections: removed.sections.map((section, sectionIndex) => sectionIndex ? section : {
    ...section,
    measures: section.measures.map((measure, measureIndex) => measureIndex ? measure : {
      ...measure,
      chordEvents: [{ id: "keep", chordSymbol: "E♭maj7", chartChord: "E♭maj7", nashvilleNumber: "1maj7", startTime: 0, endTime: 3, measureNumber: 1, beat: 1, confidence: "high", userEdited: true, confirmed: true }],
    }),
  }) };
  assert.strictEqual(removeEmptySongMeasure(populated, 0, 0), populated);
  const removedWithChords = removeSongMeasure(populated, 0, 0);
  assert.equal(removedWithChords.sections[0].measures.length, 1);
  const locked = { ...populated, sections: populated.sections.map((section, sectionIndex) => sectionIndex ? section : {
    ...section,
    measures: section.measures.map((measure, measureIndex) => measureIndex ? measure : {
      ...measure,
      chordEvents: measure.chordEvents.map(event => ({ ...event, locked: true })),
    }),
  }) };
  assert.strictEqual(removeSongMeasure(locked, 0, 0), locked);
});

test("manual chord-bank choices retain key spelling and simple entries fill the bar musically", () => {
  assert.ok(chordBankForKey("C♯").some(choice => choice.chord === "E♯m" && choice.roman === "iii"));
  assert.ok(chordBankForKey("A♭").some(choice => choice.chord === "D♭" && choice.roman === "IV"));
  assert.ok(chordBankForKey("E♭", "minor").some(choice => choice.chord === "B♭7" && choice.roman === "V7"));
  assert.equal(validateChartFile({ name: "lead-sheet.pdf", size: 100, type: "application/pdf" }).valid, true);
  assert.equal(validateChartFile({ name: "large-lead-sheet.pdf", size: 26 * 1024 * 1024, type: "application/pdf" }).valid, false);

  const chart = createManualSongChart({ title: "Two halves", bpm: 120, bars: 1 });
  chart.sections[0].measures[0].chordEvents.push(
    { id: "one", chordSymbol: "C", chartChord: "C", nashvilleNumber: "1", startTime: 0, endTime: 0, measureNumber: 1, beat: 1, confidence: "high", userEdited: true, confirmed: true },
    { id: "two", chordSymbol: "F", chartChord: "F", nashvilleNumber: "4", startTime: 0, endTime: 0, measureNumber: 1, beat: 2, confidence: "high", userEdited: true, confirmed: true },
  );
  const reflowed = reflowManualChart(chart);
  assert.deepEqual(reflowed.sections[0].measures[0].chordEvents.map(event => event.manualDurationBeats), [2, 2]);
  assert.deepEqual(reflowed.sections[0].measures[0].chordEvents.map(event => [event.startTime, event.endTime]), [[0, 1], [1, 2]]);
  assert.deepEqual(songChartToGospelStandard(reflowed).bars[0], { chords: ["C", "F"], durations: [2, 2], beats: 4 });

  const whole = createManualSongChart({ title: "Whole bar", bpm: 120, bars: 1 });
  whole.sections[0].measures[0].chordEvents.push({ id: "whole", chordSymbol: "C", chartChord: "C", nashvilleNumber: "1", startTime: 0, endTime: 0, measureNumber: 1, beat: 1, confidence: "high", userEdited: true, confirmed: true });
  assert.equal(reflowManualChart(whole).sections[0].measures[0].chordEvents[0].manualDurationBeats, 4);
});

test("chart editor moves, swaps, copies, and cuts chords without respelling them", () => {
  const chart = parseChordChartText("[Verse]\n| C7 | Bb/Eb |", { title: "Arrange Me" });
  const first = chordEventAtSlot(chart, { sectionIndex: 0, measureIndex: 0, beat: 1 })!;
  const slash = chordEventAtSlot(chart, { sectionIndex: 0, measureIndex: 1, beat: 1 })!;
  slash.bassNote = "Eb";
  slash.detectedNotes = ["Bb", "D", "F", "Eb"];

  const moved = moveChordEvent(chart, first.id, { sectionIndex: 0, measureIndex: 1, beat: 1 });
  assert.equal(chordEventAtSlot(moved, { sectionIndex: 0, measureIndex: 1, beat: 1 })?.chordSymbol, "C7");
  assert.equal(chordEventAtSlot(moved, { sectionIndex: 0, measureIndex: 0, beat: 1 })?.chordSymbol, "Bb/Eb");

  const slashAfterSwap = chordEventAtSlot(moved, { sectionIndex: 0, measureIndex: 0, beat: 1 })!;
  const copied = pasteChordEvent(moved, slashAfterSwap, { sectionIndex: 0, measureIndex: 1, beat: 1.5 }, "copied-slash");
  const pasted = chordEventAtSlot(copied, { sectionIndex: 0, measureIndex: 1, beat: 1.5 })!;
  assert.equal(pasted.id, "copied-slash");
  assert.equal(pasted.chordSymbol, "Bb/Eb");
  assert.equal(pasted.chartChord, "Bb/Eb");
  assert.equal(pasted.bassNote, "Eb");
  assert.deepEqual(pasted.detectedNotes, ["Bb", "D", "F", "Eb"]);
  assert.equal(chordEventAtSlot(removeChordEvent(copied, pasted.id), { sectionIndex: 0, measureIndex: 1, beat: 1.5 }), null);
});

test("chart editor pastes complete sections with independent chord identities", () => {
  const chart = parseChordChartText("[Verse]\n| Bb/Eb | F7 |\n[Chorus]\n| Ebmaj7 | Abmaj7 |", { title: "Section Copy" });
  chart.sections[0].measures[1].chordEvents[0].sustainAcrossBar = true;
  const originalIds = chart.sections[0].measures.flatMap(measure => measure.chordEvents.map(event => event.id));
  const pasted = pasteSongSection(chart, chart.sections[0], 1, "verse-copy");
  assert.equal(pasted.sections[1].name, "Verse");
  assert.deepEqual(pasted.sections[1].measures.flatMap(measure => measure.chordEvents.map(event => event.chordSymbol)), ["Bb/Eb", "F7"]);
  assert.equal(pasted.sections[1].measures[1].chordEvents[0].sustainAcrossBar, true);
  assert.ok(pasted.sections[1].measures.flatMap(measure => measure.chordEvents).every(event => !originalIds.includes(event.id)));
});

test("chart editor copies a complete measure without sharing chord identities", () => {
  const chart = parseChordChartText("[Verse]\n| Bb/Eb F7 | Ebmaj7 |", { title: "Measure Copy" });
  const source = chart.sections[0].measures[0];
  source.chordEvents[1].sustainAcrossBar = true;
  const pasted = pasteSongMeasure(chart, source, 0, 1, "bar-copy");
  const destination = pasted.sections[0].measures[1];
  assert.equal(destination.number, 2);
  assert.deepEqual(destination.chordEvents.map(event => [event.chordSymbol, event.beat]), [["Bb/Eb", 1], ["F7", 3]]);
  assert.equal(destination.chordEvents[1].sustainAcrossBar, true);
  assert.ok(destination.chordEvents.every(event => !source.chordEvents.some(original => original.id === event.id)));
});

test("whole-measure paste respects locked destination chords", () => {
  const chart = parseChordChartText("[Verse]\n| C | G7 |", { title: "Locked Bar" });
  chart.sections[0].measures[1].chordEvents[0].locked = true;
  assert.strictEqual(pasteSongMeasure(chart, chart.sections[0].measures[0], 0, 1, "blocked-copy"), chart);
});

test("published standards retain a final chord's ring-through-bar choice", () => {
  const chart = parseChordChartText("[Verse]\n| Ebmaj7 | Abmaj7 |", { title: "Sustain Choice" });
  chart.key = "E♭";
  chart.sections[0].measures[0].chordEvents[0].sustainAcrossBar = true;
  const standard = songChartToGospelStandard(chart);
  assert.deepEqual(standard.bars[0], { chords: ["E♭maj7"], durations: [4], beats: 4, sustainAcrossBars: [true] });
  assert.equal(standardTimeline(standard)[0].sustainAcrossBar, true);
  assert.equal(gospelStandardToSongChart(standard).sections[0].measures[0].chordEvents[0].sustainAcrossBar, true);
  assert.equal(standardTimeline(standard)[1].sustainAcrossBar, false);
});

test("published standards retain measured offbeat placement and a detached release", () => {
  const chart = parseChordChartText("[Verse]\n| C Dm7 |", { title: "Measured Rhythm" });
  chart.bpm = 120;
  const event = chart.sections[0].measures[0].chordEvents[1];
  event.beat = 2.5;
  event.startTime = .75;
  event.endTime = 1.25;
  event.timingAdjusted = true;
  event.releaseStyle = "detached";
  const standard = songChartToGospelStandard(chart);
  assert.deepEqual(standard.bars[0], { chords: ["C", "Dm7"], durations: [1.5, 1], beats: 4 });
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
    swingPercent: 67,
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
  assert.equal(editable.swingPercent, 67);
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
