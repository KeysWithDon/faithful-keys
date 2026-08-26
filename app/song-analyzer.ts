import { buildMajorScale, parseChordParts, parseChordRoot, parseSpelledNote, spellRomanDegree } from "./music-theory.ts";

export const ACCEPTED_MEDIA_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "mp4", "mov", "webm"] as const;
export const ACCEPTED_CHART_EXTENSIONS = ["txt", "csv", "json", "cho", "pro", "chordpro", "pdf"] as const;
export const MAX_AUDIO_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_CHART_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_CHART_FILE_BYTES = 25 * 1024 * 1024;
export const PRIVATE_LIBRARY_KEY = "faithful-keys-private-song-charts";
export const MIN_SWING_PERCENT = 50;
export const MAX_SWING_PERCENT = 75;

export function normalizeSwingPercent(value: unknown, fallback = MIN_SWING_PERCENT) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.round(Math.max(MIN_SWING_PERCENT, Math.min(MAX_SWING_PERCENT, parsed)))
    : fallback;
}

/** Snap a chart event to a beat or the following eighth-note “&”. */
export function snapBeatPosition(value: unknown, beats = 4) {
  const maximum = Math.max(1, Number(beats) || 4) + .5;
  const parsed = Number(value);
  const snapped = Number.isFinite(parsed) ? Math.round(parsed * 2) / 2 : 1;
  return Math.max(1, Math.min(maximum, snapped));
}

export function beatPositionLabel(value: number) {
  const beat = Math.floor(value);
  return Math.abs(value - beat - .5) < .01 ? `${beat} &` : String(beat);
}

/** Convert an evenly spaced logical beat position to its swung playback position. */
export function swingBeatPosition(position: number, swingPercent: unknown = MIN_SWING_PERCENT) {
  const whole = Math.floor(position);
  const fraction = position - whole;
  const swing = normalizeSwingPercent(swingPercent) / 100;
  if (fraction <= .5) return whole + fraction * 2 * swing;
  return whole + swing + (fraction - .5) * 2 * (1 - swing);
}

export type AnalysisStatus = "idle" | "queued" | "processing" | "completed" | "failed" | "review";
export type SourceType = "youtube" | "upload";
export type Confidence = "high" | "medium" | "low" | "uncertain";
export type ReviewStatus = "Confirmed" | "Likely" | "Ambiguous" | "Unknown";
export type EvidenceDecision = "pending" | "accepted" | "rejected";

export type ChartReference = {
  fileName: string;
  format: "plain-text" | "chordpro" | "csv" | "json" | "pdf";
  importedAt: string;
  chordCount: number;
};

export type PassingChordSuggestion = {
  chordSymbol: string;
  startTime: number;
  endTime: number;
  beat: number;
  confidence: number;
  reason: string;
  decision: EvidenceDecision;
};

export type ChordReview = {
  eventId: string;
  originalChord: string;
  recommendedChord: string;
  status: ReviewStatus;
  confidence: number;
  reason: string;
  alternatives: string[];
  candidateRanking: string[];
  needsHumanReview: boolean;
};

export type ChordCorrection = {
  eventId: string;
  timestamp: number;
  section: string;
  measure: number;
  beat: number;
  bassNote: string | null;
  detectedNotes: string[];
  originalResult: string;
  aiRecommendation: string | null;
  finalCorrection: string;
  chartChord?: string;
  detectedVoicing?: string[];
  melodyNotes?: string[];
  correctionType?: "chord" | "extension" | "passing-chord" | "lock";
  correctedAt: string;
};

export type ChordEvent = {
  id: string;
  chordSymbol: string;
  nashvilleNumber: string;
  startTime: number;
  endTime: number;
  measureNumber: number;
  beat: number;
  confidence: Confidence;
  userEdited: boolean;
  confirmed: boolean;
  originalChord?: string;
  confidenceScore?: number;
  timingConfidence?: number;
  bassNote?: string | null;
  detectedNotes?: string[];
  alternateCandidates?: string[];
  review?: ChordReview;
  chartChord?: string;
  locked?: boolean;
  detectedVoicing?: string[];
  accompanimentNotes?: string[];
  melodyNotes?: string[];
  possibleExtension?: string | null;
  extensionDecision?: EvidenceDecision;
  audioConfidence?: number;
  chartAudioAgreement?: number;
  conflictingAudioInterpretation?: string | null;
  selectionReason?: string;
  needsUserReview?: boolean;
  passingChordSuggestion?: PassingChordSuggestion | null;
  audioDetectedPassingChord?: boolean;
  /** Let this final chord ring through the following bar line instead of releasing at it. */
  sustainAcrossBar?: boolean;
  /** Rhythm-only phrasing returned by the private performance worker. */
  rhythmStrength?: number | null;
  releaseStyle?: "connected" | "detached" | "held" | null;
  phraseBoundary?: boolean;
  timingAdjusted?: boolean;
  /** Author-selected manual-bar duration, expressed in the measure's logical beats. */
  manualDurationBeats?: number;
};

export type Measure = { number: number; startTime: number; beats: number; chordEvents: ChordEvent[] };
export type SongSection = { id: string; name: string; order: number; startTime: number; endTime: number; measures: Measure[]; confidence: Confidence };
export type ChartHarmonyAuthority = {
  capturedAt: string;
  key: string;
  mode: "major" | "minor";
  timeSignature: string;
  swingPercent: number;
  sections: SongSection[];
};
export type PublishedStandardOrigin = {
  originalName: string;
  style: string;
  sourceTitle: string;
  note?: string;
};
export type SongChart = {
  id: string;
  title: string;
  artist: string | null;
  sourceType: SourceType;
  sourceUrl: string | null;
  key: string;
  mode: "major" | "minor";
  bpm: number | null;
  swingPercent: number;
  timeSignature: string;
  confidence: Confidence;
  durationSeconds: number | null;
  sections: SongSection[];
  analysisReview?: { status: "completed" | "unavailable"; provider: string; model: string | null; reviewedEvents: number };
  correctionHistory: ChordCorrection[];
  chartReference?: ChartReference;
  /** A chart authored in the admin editor rather than imported from a source chart. */
  manual?: boolean;
  harmonicAuthority?: ChartHarmonyAuthority;
  publishedStandard?: PublishedStandardOrigin;
  createdAt: string;
  updatedAt: string;
};

export type ChartSlot = { sectionIndex: number; measureIndex: number; beat: number };

export type ChordBankChoice = { chord: string; roman: string; group: "Core" | "Color" };

export function beatsPerMeasure(timeSignature: string) {
  return Math.max(1, Number(timeSignature.split("/")[0]) || 4);
}

/**
 * A compact, key-aware bank for manual chart entry. It uses written scale
 * degrees rather than a chromatic lookup, so a C♯ chart offers E♯m rather
 * than Fm and flat keys retain their flat spellings.
 */
export function chordBankForKey(key: string, mode: "major" | "minor" = "major"): ChordBankChoice[] {
  const scale = mode === "major"
    ? buildMajorScale(key)
    : [
      spellRomanDegree(key, 1), spellRomanDegree(key, 2), spellRomanDegree(key, 3, -1),
      spellRomanDegree(key, 4), spellRomanDegree(key, 5), spellRomanDegree(key, 6, -1), spellRomanDegree(key, 7, -1),
    ];
  const core = mode === "major"
    ? [
      [scale[0], "I"], [`${scale[0]}maj7`, "Imaj7"], [scale[1] + "m", "ii"], [`${scale[1]}m7`, "ii7"],
      [scale[2] + "m", "iii"], [`${scale[2]}m7`, "iii7"], [scale[3], "IV"], [`${scale[3]}maj7`, "IVmaj7"],
      [scale[4], "V"], [`${scale[4]}7`, "V7"], [scale[5] + "m", "vi"], [`${scale[5]}m7`, "vi7"],
      [`${scale[6]}dim`, "vii°"], [`${scale[6]}m7♭5`, "viiø7"],
    ]
    : [
      [`${scale[0]}m`, "i"], [`${scale[0]}m7`, "i7"], [`${scale[1]}dim`, "ii°"], [`${scale[1]}m7♭5`, "iiø7"],
      [scale[2], "III"], [`${scale[2]}maj7`, "IIImaj7"], [`${scale[3]}m`, "iv"], [`${scale[3]}m7`, "iv7"],
      [scale[4], "V"], [`${scale[4]}7`, "V7"], [scale[5], "♭VI"], [scale[6], "♭VII"],
    ];
  const color = mode === "major"
    ? [[`${scale[3]}m`, "iv"], [spellRomanDegree(key, 6, -1), "♭VI"], [spellRomanDegree(key, 7, -1), "♭VII"], [`${spellRomanDegree(key, 7, -1)}7`, "♭VII7"]]
    : [[`${scale[0]}mMaj7`, "iΔ7"], [`${scale[3]}m6`, "iv6"], [`${scale[4]}sus4`, "Vsus4"], [`${scale[4]}7♭9`, "V7♭9"]];
  return [
    ...core.map(([chord, roman]) => ({ chord, roman, group: "Core" as const })),
    ...color.map(([chord, roman]) => ({ chord, roman, group: "Color" as const })),
  ];
}

export function chordEventAtSlot(chart: SongChart, slot: ChartSlot) {
  return chart.sections[slot.sectionIndex]?.measures[slot.measureIndex]?.chordEvents
    .find(event => event.beat === slot.beat) ?? null;
}

function locateChordEvent(chart: SongChart, eventId: string) {
  for (let sectionIndex = 0; sectionIndex < chart.sections.length; sectionIndex += 1) {
    const section = chart.sections[sectionIndex];
    for (let measureIndex = 0; measureIndex < section.measures.length; measureIndex += 1) {
      const event = section.measures[measureIndex].chordEvents.find(item => item.id === eventId);
      if (event) return { event, sectionIndex, measureIndex, beat: event.beat };
    }
  }
  return null;
}

function placedChord(event: ChordEvent, measureNumber: number, beat: number) {
  return { ...event, measureNumber, beat, userEdited: true };
}

/** Move a chord to an empty slot, or swap it with the chord already there. */
export function moveChordEvent(chart: SongChart, eventId: string, target: ChartSlot): SongChart {
  const source = locateChordEvent(chart, eventId);
  const targetMeasure = chart.sections[target.sectionIndex]?.measures[target.measureIndex];
  if (!source || !targetMeasure || source.event.locked) return chart;
  if (source.sectionIndex === target.sectionIndex && source.measureIndex === target.measureIndex && source.beat === target.beat) return chart;
  const targetEvent = chordEventAtSlot(chart, target);
  if (targetEvent?.locked) return chart;
  const sourceMeasure = chart.sections[source.sectionIndex].measures[source.measureIndex];
  return {
    ...chart,
    sections: chart.sections.map((section, sectionIndex) => ({
      ...section,
      measures: section.measures.map((measure, measureIndex) => ({
        ...measure,
        chordEvents: [
          ...measure.chordEvents.filter(event => event.id !== source.event.id && event.id !== targetEvent?.id),
          ...(sectionIndex === target.sectionIndex && measureIndex === target.measureIndex
            ? [placedChord(source.event, targetMeasure.number, target.beat)] : []),
          ...(targetEvent && sectionIndex === source.sectionIndex && measureIndex === source.measureIndex
            ? [placedChord(targetEvent, sourceMeasure.number, source.beat)] : []),
        ],
      })),
    })),
  };
}

/** Paste an exact chord-event copy into a chart slot, replacing its unlocked contents. */
export function pasteChordEvent(chart: SongChart, sourceEvent: ChordEvent, target: ChartSlot, newId: string): SongChart {
  const targetMeasure = chart.sections[target.sectionIndex]?.measures[target.measureIndex];
  if (!targetMeasure) return chart;
  const targetEvent = chordEventAtSlot(chart, target);
  if (targetEvent?.locked) return chart;
  const pasted = placedChord({ ...sourceEvent, id: newId }, targetMeasure.number, target.beat);
  return {
    ...chart,
    sections: chart.sections.map((section, sectionIndex) => sectionIndex !== target.sectionIndex ? section : {
      ...section,
      measures: section.measures.map((measure, measureIndex) => measureIndex !== target.measureIndex ? measure : {
        ...measure,
        chordEvents: [...measure.chordEvents.filter(event => event.id !== targetEvent?.id), pasted],
      }),
    }),
  };
}

/** Remove an unlocked chord while returning the untouched chart for invalid requests. */
export function removeChordEvent(chart: SongChart, eventId: string): SongChart {
  const source = locateChordEvent(chart, eventId);
  if (!source || source.event.locked) return chart;
  return {
    ...chart,
    sections: chart.sections.map((section, sectionIndex) => sectionIndex !== source.sectionIndex ? section : {
      ...section,
      measures: section.measures.map((measure, measureIndex) => measureIndex !== source.measureIndex ? measure : {
        ...measure,
        chordEvents: measure.chordEvents.filter(event => event.id !== eventId),
      }),
    }),
  };
}

/** Replace a destination section with a complete, independently editable copy. */
export function pasteSongSection(chart: SongChart, source: SongSection, targetSectionIndex: number, idPrefix: string): SongChart {
  const target = chart.sections[targetSectionIndex];
  if (!target) return chart;
  const pasted: SongSection = {
    ...source,
    id: `${idPrefix}-section`,
    order: target.order,
    measures: source.measures.map((measure, measureIndex) => ({
      ...measure,
      number: measureIndex + 1,
      chordEvents: measure.chordEvents.map((event, eventIndex) => ({
        ...event,
        id: `${idPrefix}-event-${measureIndex + 1}-${eventIndex + 1}`,
        measureNumber: measureIndex + 1,
        userEdited: true,
      })),
    })),
  };
  return { ...chart, sections: chart.sections.map((section, index) => index === targetSectionIndex ? pasted : section) };
}

/** Replace one destination bar with an independently editable measure copy. */
export function pasteSongMeasure(chart: SongChart, source: Measure, targetSectionIndex: number, targetMeasureIndex: number, idPrefix: string): SongChart {
  const target = chart.sections[targetSectionIndex]?.measures[targetMeasureIndex];
  if (!target || target.chordEvents.some(event => event.locked)) return chart;
  const timeOffset = target.startTime - source.startTime;
  const pasted: Measure = {
    ...source,
    number: target.number,
    startTime: target.startTime,
    chordEvents: source.chordEvents.map((event, eventIndex) => ({
      ...event,
      id: `${idPrefix}-event-${eventIndex + 1}`,
      measureNumber: target.number,
      startTime: Math.max(0, event.startTime + timeOffset),
      endTime: Math.max(0, event.endTime + timeOffset),
      userEdited: true,
    })),
  };
  return {
    ...chart,
    sections: chart.sections.map((section, sectionIndex) => sectionIndex !== targetSectionIndex ? section : {
      ...section,
      measures: section.measures.map((measure, measureIndex) => measureIndex === targetMeasureIndex ? pasted : measure),
    }),
  };
}

export type AnalysisJob = {
  id: string;
  sourceType: SourceType;
  status: AnalysisStatus;
  progress: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
};

function elapsedLabel(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder.toString().padStart(2, "0")}s` : `${remainder}s`;
}

/**
 * Analysis duration depends on media length, download speed, and worker load,
 * so an invented completion percentage is misleading. Active jobs expose a
 * real stage plus elapsed time; only completed work is called 100%.
 */
export function analysisProgressPresentation(job: AnalysisJob, now = Date.now()) {
  const created = Date.parse(job.createdAt);
  const elapsed = elapsedLabel((now - (Number.isFinite(created) ? created : now)) / 1000);
  if (job.status === "completed") return { stage: "Chart ready", detail: "Analysis completed and saved.", elapsed, percent: 100, indeterminate: false };
  if (job.status === "failed") return { stage: "Analysis stopped", detail: job.error ?? "The analyzer could not finish.", elapsed, percent: 0, indeterminate: false };
  if (job.status === "processing") return {
    stage: "Measuring performance rhythm",
    detail: `Working for ${elapsed} · exact finish time depends on the media length and source.`,
    elapsed, percent: null, indeterminate: true,
  };
  if (job.status === "queued") return {
    stage: "Waiting for the analyzer",
    detail: `Queued for ${elapsed} · processing will begin as soon as the worker is available.`,
    elapsed, percent: null, indeterminate: true,
  };
  return { stage: "Ready", detail: "Ready to begin.", elapsed, percent: 0, indeterminate: false };
}

const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const SCALE_LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

export function validateYouTubeUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return { valid: false as const, error: "Use a secure YouTube video link." };
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const videoId = /^[A-Za-z0-9_-]{6,}$/;
    const valid = host === "youtu.be"
      ? videoId.test(url.pathname.replace(/^\//, ""))
      : ["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host) && (
        (url.pathname === "/watch" && videoId.test(url.searchParams.get("v") ?? ""))
        || (/^\/shorts\/[A-Za-z0-9_-]{6,}\/?$/.test(url.pathname))
      );
    return valid ? { valid: true as const, normalized: url.toString() } : { valid: false as const, error: "Use a standard YouTube watch or short link." };
  } catch { return { valid: false as const, error: "Paste a complete YouTube URL." }; }
}

export function validateMediaFile(file: Pick<File, "name" | "size" | "type"> | null) {
  if (!file) return { valid: false as const, error: "Choose an audio or video file to continue." };
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const looksLikeMedia = file.type.startsWith("audio/") || file.type.startsWith("video/") || ACCEPTED_MEDIA_EXTENSIONS.includes(extension as typeof ACCEPTED_MEDIA_EXTENSIONS[number]);
  if (!looksLikeMedia) return { valid: false as const, error: "Use MP3, WAV, M4A, AAC, FLAC, OGG, MP4, MOV, or WebM." };
  if (file.size <= 0) return { valid: false as const, error: "That media file is empty." };
  if (file.size > MAX_AUDIO_FILE_BYTES) return { valid: false as const, error: "Choose a media file under 100 MB." };
  return { valid: true as const };
}

/** Backward-compatible name for older callers and exported charts. */
export const validateAudioFile = validateMediaFile;

export function validateChartFile(file: Pick<File, "name" | "size" | "type"> | null) {
  if (!file) return { valid: false as const, error: "Upload a chord chart first." };
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED_CHART_EXTENSIONS.includes(extension as typeof ACCEPTED_CHART_EXTENSIONS[number])) {
    return { valid: false as const, error: "Use a text, CSV, ChordPro, PDF, or Faithful Keys JSON chart." };
  }
  if (file.size <= 0) return { valid: false as const, error: "That chord chart is empty." };
  const maxBytes = extension === "pdf" ? MAX_PDF_CHART_FILE_BYTES : MAX_CHART_FILE_BYTES;
  if (file.size > maxBytes) return { valid: false as const, error: `Choose a ${extension === "pdf" ? "PDF under 25 MB" : "chord chart under 5 MB"}.` };
  return { valid: true as const };
}

export function canStartAnalysis(sourceType: SourceType, permissionConfirmed: boolean, source: string | Pick<File, "name" | "size" | "type"> | null) {
  if (!permissionConfirmed) return { allowed: false, error: "Confirm that you own the audio or have permission to analyze it." };
  const validation = sourceType === "youtube"
    ? validateYouTubeUrl(String(source ?? ""))
    : validateMediaFile(source as Pick<File, "name" | "size" | "type"> | null);
  return validation.valid
    ? { allowed: true as const }
    : { allowed: false as const, error: validation.error };
}

export function filenameTitle(filename: string) {
  const withoutExtension = filename.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim();
  return withoutExtension || "Untitled song";
}

const SECTION_LINE = /^(?:\[|\{(?:start_of_|soc:)?)(intro|verse|pre[ -]?chorus|chorus|bridge|tag|vamp|outro)(?:\s*\d+)?(?:\]|\})\s*:?$/i;
const CHORD_TOKEN = /^[A-G](?:#{1,2}|b{1,2}|♯{1,2}|♭{1,2}|𝄪|𝄫)?(?:(?:maj|min|m|dim|aug|sus|add|alt|M|Δ|ø|°|\+|-|no|omit|[0-9#b♯♭()])|\/(?![A-G](?:#{1,2}|b{1,2}|♯{1,2}|♭{1,2}|𝄪|𝄫)?$))*(?:\/[A-G](?:#{1,2}|b{1,2}|♯{1,2}|♭{1,2}|𝄪|𝄫)?)?$/;

function prettySectionName(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function chordTokens(line: string) {
  const chordPro = [...line.matchAll(/\[([^\]]+)\]/g)].map(match => match[1].trim());
  const source = chordPro.length ? chordPro : line
    .replace(/\|/g, " ")
    .replace(/[,;]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map(token => token.trim());
  return source
    // Preserve the chart's written symbol byte-for-byte apart from punctuation
    // that separates it from prose. Theory helpers normalize a temporary copy
    // for pitch comparisons; the reader must keep source spellings such as
    // `Bb/Eb`, `B♭/E♭`, `C#/G#`, and `C♯/G♯` distinct.
    .map(token => token.replace(/[.:]+$/, ""))
    .filter(token => CHORD_TOKEN.test(token));
}

function chartFromSections(input: {
  title: string;
  sourceType?: SourceType;
  fileName: string;
  format: ChartReference["format"];
  sections: Array<{ name: string; bars: string[][] }>;
  key?: string;
  mode?: "major" | "minor";
  meter?: string;
}) {
  const chart = createPrivateReviewChart({ sourceType: input.sourceType ?? "upload", title: input.title });
  const numerator = Math.max(1, Number((input.meter ?? "4/4").split("/")[0]) || 4);
  chart.key = input.key ?? "C";
  chart.mode = input.mode ?? "major";
  chart.timeSignature = input.meter ?? "4/4";
  chart.chartReference = { fileName: input.fileName, format: input.format, importedAt: new Date().toISOString(), chordCount: 0 };
  chart.sections = input.sections.filter(section => section.bars.some(bar => bar.length)).map((section, sectionIndex) => ({
    id: id("section"), name: section.name || `Section ${sectionIndex + 1}`, order: sectionIndex + 1,
    startTime: 0, endTime: 0, confidence: "medium" as const,
    measures: section.bars.filter(bar => bar.length).map((bar, measureIndex) => ({
      number: measureIndex + 1, startTime: 0, beats: numerator,
      chordEvents: bar.slice(0, numerator * 2).map((symbol, chordIndex) => {
        const beat = snapBeatPosition(1 + chordIndex * numerator / Math.max(1, bar.length), numerator);
        return {
          id: id("chart-chord"), chordSymbol: symbol, chartChord: symbol, nashvilleNumber: "?", startTime: 0, endTime: 0,
          measureNumber: measureIndex + 1, beat, confidence: "medium" as const, userEdited: false, confirmed: false,
          locked: false, extensionDecision: "pending" as const, needsUserReview: false,
        };
      }),
    })),
  }));
  if (!chart.sections.length) throw new Error("No chord symbols were found in that chart.");
  chart.chartReference.chordCount = chart.sections.flatMap(section => section.measures).reduce((count, measure) => count + measure.chordEvents.length, 0);
  return normalizedChart(chart);
}

export function parseChordChartText(text: string, options: { title?: string; fileName?: string; format?: ChartReference["format"] } = {}): SongChart {
  const value = text.trim();
  if (!value) throw new Error("Paste or upload a chord chart with at least one chord.");
  if ((options.format === "json" || value.startsWith("{")) && value.startsWith("{")) {
    const parsed = JSON.parse(value) as Partial<SongChart> & { sections?: SongSection[] };
    if (!Array.isArray(parsed.sections) || !parsed.sections.some(section => section.measures?.some(measure => measure.chordEvents?.length))) {
      throw new Error("That JSON file does not contain a Faithful Keys chord chart.");
    }
    const now = new Date().toISOString();
    const chart = normalizedChart({
      ...createPrivateReviewChart({ sourceType: parsed.sourceType ?? "upload", title: parsed.title ?? options.title }),
      ...parsed,
      id: id("chart"), sourceUrl: null, correctionHistory: Array.isArray(parsed.correctionHistory) ? parsed.correctionHistory : [],
      createdAt: now, updatedAt: now,
      chartReference: { fileName: options.fileName ?? "Imported Faithful Keys chart.json", format: "json", importedAt: now,
        chordCount: parsed.sections.flatMap(section => section.measures).reduce((count, measure) => count + measure.chordEvents.length, 0) },
    } as SongChart);
    chart.sections = chart.sections.map(section => ({ ...section, measures: section.measures.map(measure => ({ ...measure,
      chordEvents: measure.chordEvents.map(event => ({ ...event, chartChord: event.chartChord ?? event.chordSymbol, locked: Boolean(event.locked) })),
    })) }));
    return chart;
  }

  const sections: Array<{ name: string; bars: string[][] }> = [];
  let current = { name: "Verse", bars: [] as string[][] };
  const pushCurrent = () => { if (current.bars.some(bar => bar.length)) sections.push(current); };
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^\s*(?:#|\/\/)/.test(line)) continue;
    const sectionMatch = line.match(SECTION_LINE) ?? line.match(/^(Intro|Verse|Pre[ -]?Chorus|Chorus|Bridge|Tag|Vamp|Outro)(?:\s*\d+)?\s*:?$/i);
    if (sectionMatch) {
      pushCurrent();
      current = { name: prettySectionName(sectionMatch[1]), bars: [] };
      continue;
    }
    const bars = line.includes("|") ? line.split("|") : [line];
    for (const bar of bars) {
      const tokens = chordTokens(bar);
      if (tokens.length) current.bars.push(tokens);
    }
  }
  pushCurrent();
  const extension = (options.fileName ?? "").split(".").pop()?.toLowerCase();
  const format = options.format ?? (extension === "csv" ? "csv" : /\[[A-G][^\]]*\]/.test(value) ? "chordpro" : "plain-text");
  return chartFromSections({ title: options.title ?? filenameTitle(options.fileName ?? "Imported chart"), fileName: options.fileName ?? "Pasted chart", format, sections });
}

type PdfTextItem = { str?: string; transform?: number[] };

/** Extract a selectable-text PDF locally in the browser; source files never leave the device. */
export async function extractPdfChartText(file: File) {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const content = await (await document.getPage(pageNumber)).getTextContent();
      const rows = new Map<number, Array<{ x: number; text: string }>>();
      for (const rawItem of content.items as PdfTextItem[]) {
        const text = rawItem.str?.trim();
        if (!text) continue;
        const x = Number(rawItem.transform?.[4] ?? 0);
        const y = Math.round(Number(rawItem.transform?.[5] ?? 0) / 3) * 3;
        rows.set(y, [...(rows.get(y) ?? []), { x, text }]);
      }
      for (const [, row] of [...rows.entries()].sort(([left], [right]) => right - left)) {
        const line = row.sort((left, right) => left.x - right.x).map(item => item.text).join(" ").replace(/\s+/g, " ").trim();
        if (line) lines.push(line);
      }
    }
  } finally { await document.destroy(); }
  if (!lines.length) throw new Error("No selectable text was found in that PDF. Use a text-based PDF or OCR it before importing.");
  return lines.join("\n");
}

export async function parseChordChartFile(file: File) {
  const validation = validateChartFile(file);
  if (!validation.valid) throw new Error(validation.error);
  const extension = file.name.split(".").pop()?.toLowerCase();
  const source = extension === "pdf" ? await extractPdfChartText(file) : await file.text();
  return parseChordChartText(source, { title: filenameTitle(file.name), fileName: file.name, format: extension === "json" ? "json" : extension === "csv" ? "csv" : extension === "pdf" ? "pdf" : undefined });
}

function id(prefix: string) { return `${prefix}-${Math.random().toString(36).slice(2, 10)}`; }

export type ManualChartInput = {
  title?: string;
  artist?: string | null;
  key?: string;
  mode?: "major" | "minor";
  bpm?: number | null;
  swingPercent?: number;
  timeSignature?: string;
  sectionName?: string;
  bars?: number;
};

function manualSecondsPerBeat(chart: Pick<SongChart, "bpm">) {
  return 60 / Math.max(10, Math.min(250, Number(chart.bpm) || 72));
}

/**
 * Keep a hand-built chart's bars in a clear, editable timeline. Imported and
 * performance-timed charts deliberately retain their measured timestamps.
 */
export function reflowManualChart(chart: SongChart): SongChart {
  if (!chart.manual) return chart;
  const beats = beatsPerMeasure(chart.timeSignature);
  const duration = beats * manualSecondsPerBeat(chart);
  let cursor = 0;
  return {
    ...chart,
    sections: chart.sections.map((section, sectionIndex) => {
      const sectionStart = cursor;
      const measures = section.measures.map((measure, measureIndex) => {
        const startTime = cursor;
        cursor += duration;
        const sourceEvents = [...measure.chordEvents]
          .map(event => ({ ...event, beat: snapBeatPosition(event.beat, beats) }))
          .sort((left, right) => left.beat - right.beat);
        // Simple on-beat manual entries share the bar evenly: one choice is a
        // whole-bar hold, two choices become two half-bar chords, and four
        // choices become quarter-bar chords. The moment an “&” is used, the
        // explicit grid placement takes priority.
        const evenOnBeatEntry = sourceEvents.length > 0
          && sourceEvents.every(event => Number.isInteger(event.beat))
          && Number.isInteger(beats / sourceEvents.length);
        const events = sourceEvents.map((event, eventIndex, all) => {
            const next = all[eventIndex + 1];
            const manualDurationBeats = evenOnBeatEntry
              ? beats / sourceEvents.length
              : Math.max(.5, (next?.beat ?? beats + 1) - event.beat);
            const startBeat = evenOnBeatEntry ? 1 + eventIndex * manualDurationBeats : event.beat;
            const eventStart = startTime + (startBeat - 1) * manualSecondsPerBeat(chart);
            const eventEnd = eventStart + manualDurationBeats * manualSecondsPerBeat(chart);
            return {
              ...event,
              measureNumber: measureIndex + 1,
              startTime: eventStart,
              endTime: Math.max(eventStart, eventEnd),
              manualDurationBeats,
            };
          });
        return { ...measure, number: measureIndex + 1, startTime, beats, chordEvents: events };
      });
      return {
        ...section,
        order: sectionIndex + 1,
        startTime: sectionStart,
        endTime: cursor,
        measures,
      };
    }),
    durationSeconds: cursor,
  };
}

/** Create an intentionally blank, hand-authored chart. No chords are invented. */
export function createManualSongChart(input: ManualChartInput = {}): SongChart {
  const now = new Date().toISOString();
  const timeSignature = input.timeSignature ?? "4/4";
  const beats = beatsPerMeasure(timeSignature);
  const bars = Math.max(1, Math.min(128, Math.floor(Number(input.bars) || 4)));
  const chart: SongChart = {
    id: id("chart"),
    title: input.title?.trim() || "Untitled custom chart",
    artist: input.artist?.trim() || null,
    sourceType: "upload",
    sourceUrl: null,
    key: input.key ?? "C",
    mode: input.mode ?? "major",
    bpm: Number.isFinite(input.bpm) ? Math.max(10, Math.min(250, Number(input.bpm))) : 72,
    swingPercent: normalizeSwingPercent(input.swingPercent ?? MIN_SWING_PERCENT),
    timeSignature,
    confidence: "high",
    durationSeconds: null,
    correctionHistory: [],
    manual: true,
    createdAt: now,
    updatedAt: now,
    sections: [{
      id: id("section"),
      name: input.sectionName?.trim() || "Verse",
      order: 1,
      startTime: 0,
      endTime: 0,
      confidence: "high",
      measures: Array.from({ length: bars }, (_, index) => ({
        number: index + 1,
        startTime: 0,
        beats,
        chordEvents: [],
      })),
    }],
  };
  return normalizedChart(reflowManualChart(chart));
}

/** Append an empty bar so the author can freely enter chords at any beat or “&”. */
export function appendSongMeasure(chart: SongChart, sectionIndex: number): SongChart {
  const section = chart.sections[sectionIndex];
  if (!section) return chart;
  const beats = beatsPerMeasure(chart.timeSignature);
  const next = {
    ...chart,
    sections: chart.sections.map((item, index) => index !== sectionIndex ? item : {
      ...item,
      measures: [...item.measures, {
        number: item.measures.length + 1,
        startTime: 0,
        beats,
        chordEvents: [],
      }],
    }),
  };
  return normalizedChart(reflowManualChart(next));
}

/** Remove only an empty bar—authors must clear a populated bar deliberately first. */
export function removeEmptySongMeasure(chart: SongChart, sectionIndex: number, measureIndex: number): SongChart {
  const section = chart.sections[sectionIndex];
  const measure = section?.measures[measureIndex];
  if (!section || !measure || section.measures.length <= 1 || measure.chordEvents.length) return chart;
  const next = {
    ...chart,
    sections: chart.sections.map((item, index) => index !== sectionIndex ? item : {
      ...item,
      measures: item.measures.filter((_itemMeasure, itemIndex) => itemIndex !== measureIndex),
    }),
  };
  return normalizedChart(reflowManualChart(next));
}

/** Remove a manually-authored bar after the editor has confirmed any chord deletion. */
export function removeSongMeasure(chart: SongChart, sectionIndex: number, measureIndex: number): SongChart {
  const section = chart.sections[sectionIndex];
  const measure = section?.measures[measureIndex];
  if (!section || !measure || section.measures.length <= 1 || measure.chordEvents.some(event => event.locked)) return chart;
  const next = {
    ...chart,
    sections: chart.sections.map((item, index) => index !== sectionIndex ? item : {
      ...item,
      measures: item.measures.filter((_itemMeasure, itemIndex) => itemIndex !== measureIndex),
    }),
  };
  return normalizedChart(reflowManualChart(next));
}

/** Add another named, blank section without forcing a musical form. */
export function appendSongSection(chart: SongChart, name = "New section", bars = 4): SongChart {
  const beats = beatsPerMeasure(chart.timeSignature);
  const barCount = Math.max(1, Math.min(128, Math.floor(Number(bars) || 4)));
  const next: SongChart = {
    ...chart,
    sections: [...chart.sections, {
      id: id("section"),
      name: name.trim() || `Section ${chart.sections.length + 1}`,
      order: chart.sections.length + 1,
      startTime: 0,
      endTime: 0,
      confidence: "high",
      measures: Array.from({ length: barCount }, (_, index) => ({ number: index + 1, startTime: 0, beats, chordEvents: [] })),
    }],
  };
  return normalizedChart(reflowManualChart(next));
}

/** Remove a whole manually-authored section while preserving a usable chart. */
export function removeSongSection(chart: SongChart, sectionIndex: number): SongChart {
  const section = chart.sections[sectionIndex];
  if (!section || chart.sections.length <= 1 || section.measures.some(measure => measure.chordEvents.some(event => event.locked))) return chart;
  return normalizedChart(reflowManualChart({
    ...chart,
    sections: chart.sections.filter((_section, index) => index !== sectionIndex),
  }));
}

/** A blank review chart intentionally has no fabricated recognition results. */
export function createPrivateReviewChart(input: { sourceType: SourceType; title?: string; sourceUrl?: string | null }): SongChart {
  const now = new Date().toISOString();
  return {
    id: id("chart"), title: input.title?.trim() || "Untitled song", artist: null,
    sourceType: input.sourceType, sourceUrl: input.sourceUrl ?? null, key: "C", mode: "major", bpm: null, swingPercent: 50,
    timeSignature: "4/4", confidence: "uncertain", durationSeconds: null, createdAt: now, updatedAt: now,
    correctionHistory: [],
    sections: [{ id: id("section"), name: "Verse", order: 1, startTime: 0, endTime: 0, confidence: "uncertain", measures: [{ number: 1, startTime: 0, beats: 4, chordEvents: [] }] }],
  };
}

export function nashvilleNumber(chord: string, tonic: string, mode: "major" | "minor" = "major") {
  if (!chord || chord === "?") return "?";
  const parsed = parseChordParts(chord);
  const tonicNote = parseSpelledNote(tonic);
  const root = parsed.root;
  const diatonicSteps = (SCALE_LETTERS.indexOf(root.letter) - SCALE_LETTERS.indexOf(tonicNote.letter) + 7) % 7;
  const expected = [0, 2, 4, 5, 7, 9, 11][diatonicSteps];
  const actual = (root.pitchClass - tonicNote.pitchClass + 12) % 12;
  const delta = ((actual - expected + 18) % 12) - 6;
  const numerals = ["1", "2", "3", "4", "5", "6", "7"];
  const accidental = delta === -2 ? "♭♭" : delta === -1 ? "♭" : delta === 1 ? "♯" : delta === 2 ? "♯♯" : "";
  const minor = /(^|[^a-z])m(?!aj)/i.test(parsed.suffix) || (mode === "minor" && [0, 3, 4].includes(diatonicSteps));
  const diminished = /dim|♭5/.test(parsed.suffix);
  const extension = parsed.suffix.match(/(7|9|11|13)/)?.[1] ?? "";
  const numeral = numerals[diatonicSteps];
  // Nashville notation keeps the written quality. That means a flat-two
  // major seventh is visibly distinct from a dominant flat-two.
  const quality = diminished ? `°${extension}`
    : /^maj/i.test(parsed.suffix) ? `maj${extension}`
    : minor ? `m${extension}`
    : extension;
  return `${accidental}${numeral}${quality}`;
}

export function transposeChordSymbol(symbol: string, semitones: number, preferFlats = false) {
  if (!symbol || symbol === "?") return symbol;
  const transposeNote = (note: string) => {
    const source = parseSpelledNote(note);
    const nextPitch = (source.pitchClass + semitones + 120) % 12;
    const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
    return names[nextPitch];
  };
  const parsed = parseChordParts(symbol);
  return `${transposeNote(parsed.root.display)}${parsed.suffix}${parsed.slashBass ? `/${transposeNote(parsed.slashBass.display)}` : ""}`;
}

export function transposeSongChart(chart: SongChart, semitones: number) {
  const tonic = parseSpelledNote(chart.key);
  const key = (semitones >= 0 ? SHARP_NAMES : FLAT_NAMES)[(tonic.pitchClass + semitones + 120) % 12];
  return {
    ...chart, key, updatedAt: new Date().toISOString(),
    sections: chart.sections.map(section => ({ ...section, measures: section.measures.map(measure => ({ ...measure, chordEvents: measure.chordEvents.map(event => {
      const chordSymbol = transposeChordSymbol(event.chordSymbol, semitones, semitones < 0);
      return { ...event, chordSymbol, chartChord: chordSymbol, nashvilleNumber: nashvilleNumber(chordSymbol, key, chart.mode), userEdited: true };
    }) })) })),
  };
}

function copySections(sections: SongSection[]): SongSection[] {
  return sections.map(section => ({
    ...section,
    measures: section.measures.map(measure => ({
      ...measure,
      chordEvents: measure.chordEvents.map(event => ({
        ...event,
        detectedNotes: event.detectedNotes ? [...event.detectedNotes] : undefined,
        alternateCandidates: event.alternateCandidates ? [...event.alternateCandidates] : undefined,
        detectedVoicing: event.detectedVoicing ? [...event.detectedVoicing] : undefined,
        accompanimentNotes: event.accompanimentNotes ? [...event.accompanimentNotes] : undefined,
        melodyNotes: event.melodyNotes ? [...event.melodyNotes] : undefined,
      })),
    })),
  }));
}

/** Freeze the editor's exact harmony immediately before a timing-only run. */
export function captureChartHarmony(chart: SongChart): SongChart {
  const clean = normalizedChart(chart);
  return {
    ...clean,
    harmonicAuthority: {
      capturedAt: new Date().toISOString(),
      key: clean.key,
      mode: clean.mode,
      timeSignature: clean.timeSignature,
      swingPercent: clean.swingPercent,
      sections: copySections(clean.sections),
    },
  };
}

/**
 * Consume a one-run harmony snapshot after the cloud returns timing metadata.
 * Only timestamps/confidence cross from the result; every written chord and
 * structural decision comes back from the pre-analysis editor snapshot.
 */
export function restoreChartHarmony(chart: SongChart): SongChart {
  const authority = chart.harmonicAuthority;
  if (!authority?.sections?.length) return chart;
  const timingEvents = chart.sections.flatMap(section => section.measures.flatMap(measure => measure.chordEvents));
  const timingById = new Map(timingEvents.map(event => [event.id, event]));
  let eventIndex = 0;
  const sections = copySections(authority.sections).map(section => {
    const measures = section.measures.map(measure => ({
      ...measure,
      chordEvents: measure.chordEvents.map(event => {
        const timing = timingById.get(event.id) ?? timingEvents[eventIndex];
        eventIndex += 1;
        const chordSymbol = event.chartChord ?? event.chordSymbol;
        const startTime = Number.isFinite(timing?.startTime) ? Number(timing?.startTime) : event.startTime;
        const endTime = Number.isFinite(timing?.endTime) ? Math.max(startTime, Number(timing?.endTime)) : Math.max(startTime, event.endTime);
        const timingConfidence = Math.max(0, Math.min(1, Number(timing?.timingConfidence ?? timing?.confidenceScore ?? .5)));
        const reason = "The uploaded chart supplied this exact chord spelling; the performance supplied only rhythmic timing.";
        return {
          ...event,
          chordSymbol,
          chartChord: chordSymbol,
          originalChord: chordSymbol,
          startTime,
          endTime,
          confidence: timingConfidence >= .8 ? "high" as const : "medium" as const,
          confidenceScore: timingConfidence,
          timingConfidence,
          bassNote: null,
          detectedNotes: [],
          alternateCandidates: [],
          detectedVoicing: [],
          accompanimentNotes: [],
          melodyNotes: [],
          possibleExtension: null,
          extensionDecision: "pending" as const,
          audioConfidence: undefined,
          chartAudioAgreement: undefined,
          conflictingAudioInterpretation: null,
          selectionReason: reason,
          needsUserReview: false,
          passingChordSuggestion: null,
          audioDetectedPassingChord: false,
          review: {
            eventId: event.id,
            originalChord: chordSymbol,
            recommendedChord: chordSymbol,
            status: timingConfidence >= .8 ? "Confirmed" as const : "Likely" as const,
            confidence: timingConfidence,
            reason,
            alternatives: [],
            candidateRanking: [chordSymbol],
            needsHumanReview: false,
          },
        };
      }),
    }));
    const events = measures.flatMap(measure => measure.chordEvents);
    return {
      ...section,
      measures,
      startTime: events.length ? Math.min(...events.map(event => event.startTime)) : section.startTime,
      endTime: events.length ? Math.max(...events.map(event => event.endTime)) : section.endTime,
    };
  });
  const { harmonicAuthority: _consumed, ...rest } = chart;
  return {
    ...rest,
    key: authority.key,
    mode: authority.mode,
    timeSignature: authority.timeSignature,
    swingPercent: normalizeSwingPercent(authority.swingPercent),
    sections,
  };
}

export function normalizedChart(chart: SongChart): SongChart {
  const numerator = Number(chart.timeSignature.split("/")[0]) || 4;
  return {
    ...chart,
    swingPercent: normalizeSwingPercent(chart.swingPercent),
    correctionHistory: Array.isArray(chart.correctionHistory) ? chart.correctionHistory : [],
    sections: [...chart.sections].sort((a, b) => a.order - b.order).map((section, sectionIndex) => ({
      ...section, order: sectionIndex + 1,
      measures: [...section.measures].sort((a, b) => a.number - b.number).map((measure, measureIndex) => ({
        ...measure, number: measureIndex + 1, beats: numerator,
        chordEvents: [...measure.chordEvents].map(event => ({ ...event, beat: snapBeatPosition(event.beat, numerator) }))
          .filter(event => event.beat >= 1 && event.beat <= numerator + .5).sort((a, b) => a.beat - b.beat).map(event => {
          // chartChord is the persistent source symbol. Legacy analyzer results
          // may have changed chordSymbol enharmonically, so prefer chartChord
          // whenever it exists. Intentional edits update both fields.
          const chordSymbol = event.chartChord ?? event.chordSymbol;
          return { ...event, chordSymbol, chartChord: chordSymbol, nashvilleNumber: nashvilleNumber(chordSymbol, chart.key, chart.mode) };
        }),
      })),
    })),
  };
}

export function sectionLoopWindow(section: SongSection) { return { start: section.startTime, end: Math.max(section.startTime, section.endTime) }; }

export function loadPrivateCharts(storage: Pick<Storage, "getItem">): SongChart[] {
  try { const value = storage.getItem(PRIVATE_LIBRARY_KEY); return value ? JSON.parse(value) : []; } catch { return []; }
}

export function savePrivateCharts(storage: Pick<Storage, "setItem">, charts: SongChart[]) { storage.setItem(PRIVATE_LIBRARY_KEY, JSON.stringify(charts.map(normalizedChart))); }
