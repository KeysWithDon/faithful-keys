import { parseChordRoot, parseSpelledNote } from "./music-theory.ts";

export const ACCEPTED_AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg"] as const;
export const MAX_AUDIO_FILE_BYTES = 100 * 1024 * 1024;
export const PRIVATE_LIBRARY_KEY = "faithful-keys-private-song-charts";

export type AnalysisStatus = "idle" | "queued" | "processing" | "completed" | "failed" | "review";
export type SourceType = "youtube" | "upload";
export type Confidence = "high" | "medium" | "low" | "uncertain";

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
};

export type Measure = { number: number; startTime: number; beats: number; chordEvents: ChordEvent[] };
export type SongSection = { id: string; name: string; order: number; startTime: number; endTime: number; measures: Measure[]; confidence: Confidence };
export type SongChart = {
  id: string;
  title: string;
  artist: string | null;
  sourceType: SourceType;
  sourceUrl: string | null;
  key: string;
  mode: "major" | "minor";
  bpm: number | null;
  timeSignature: string;
  confidence: Confidence;
  durationSeconds: number | null;
  sections: SongSection[];
  createdAt: string;
  updatedAt: string;
};

export type AnalysisJob = {
  id: string;
  sourceType: SourceType;
  status: AnalysisStatus;
  progress: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
};

const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const SCALE_LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

export function validateYouTubeUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const valid = (host === "youtube.com" && (url.pathname === "/watch" || url.pathname.startsWith("/shorts/")) && Boolean(url.searchParams.get("v") || url.pathname.startsWith("/shorts/"))) || host === "youtu.be";
    return valid ? { valid: true as const, normalized: url.toString() } : { valid: false as const, error: "Use a standard YouTube watch or short link." };
  } catch { return { valid: false as const, error: "Paste a complete YouTube URL." }; }
}

export function validateAudioFile(file: Pick<File, "name" | "size" | "type"> | null) {
  if (!file) return { valid: false as const, error: "Choose an audio file to continue." };
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const looksAudio = file.type.startsWith("audio/") || ACCEPTED_AUDIO_EXTENSIONS.includes(extension as typeof ACCEPTED_AUDIO_EXTENSIONS[number]);
  if (!looksAudio) return { valid: false as const, error: "Use MP3, WAV, M4A, AAC, FLAC, or OGG audio." };
  if (file.size <= 0) return { valid: false as const, error: "That audio file is empty." };
  if (file.size > MAX_AUDIO_FILE_BYTES) return { valid: false as const, error: "Choose an audio file under 100 MB." };
  return { valid: true as const };
}

export function canStartAnalysis(sourceType: SourceType, permissionConfirmed: boolean, source: string | Pick<File, "name" | "size" | "type"> | null) {
  if (!permissionConfirmed) return { allowed: false, error: "Confirm that you own the audio or have permission to analyze it." };
  const validation = sourceType === "youtube"
    ? validateYouTubeUrl(String(source ?? ""))
    : validateAudioFile(source as Pick<File, "name" | "size" | "type"> | null);
  return validation.valid
    ? { allowed: true as const }
    : { allowed: false as const, error: validation.error };
}

export function filenameTitle(filename: string) {
  const withoutExtension = filename.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim();
  return withoutExtension || "Untitled song";
}

function id(prefix: string) { return `${prefix}-${Math.random().toString(36).slice(2, 10)}`; }

/** A blank review chart intentionally has no fabricated recognition results. */
export function createPrivateReviewChart(input: { sourceType: SourceType; title?: string; sourceUrl?: string | null }): SongChart {
  const now = new Date().toISOString();
  return {
    id: id("chart"), title: input.title?.trim() || "Untitled song", artist: null,
    sourceType: input.sourceType, sourceUrl: input.sourceUrl ?? null, key: "C", mode: "major", bpm: null,
    timeSignature: "4/4", confidence: "uncertain", durationSeconds: null, createdAt: now, updatedAt: now,
    sections: [{ id: id("section"), name: "Section 1", order: 1, startTime: 0, endTime: 0, confidence: "uncertain", measures: Array.from({ length: 4 }, (_, index) => ({ number: index + 1, startTime: 0, beats: 4, chordEvents: [] })) }],
  };
}

export function nashvilleNumber(chord: string, tonic: string, mode: "major" | "minor" = "major") {
  if (!chord || chord === "?") return "?";
  const parsed = parseChordRoot(chord);
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
  const [main, bass] = symbol.split("/");
  const transposeNote = (note: string) => {
    const source = parseSpelledNote(note);
    const nextPitch = (source.pitchClass + semitones + 120) % 12;
    const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
    return names[nextPitch];
  };
  const parsed = parseChordRoot(main);
  return `${transposeNote(parsed.root.display)}${parsed.suffix}${bass ? `/${transposeNote(bass)}` : ""}`;
}

export function transposeSongChart(chart: SongChart, semitones: number) {
  const tonic = parseSpelledNote(chart.key);
  const key = (semitones >= 0 ? SHARP_NAMES : FLAT_NAMES)[(tonic.pitchClass + semitones + 120) % 12];
  return {
    ...chart, key, updatedAt: new Date().toISOString(),
    sections: chart.sections.map(section => ({ ...section, measures: section.measures.map(measure => ({ ...measure, chordEvents: measure.chordEvents.map(event => {
      const chordSymbol = transposeChordSymbol(event.chordSymbol, semitones, semitones < 0);
      return { ...event, chordSymbol, nashvilleNumber: nashvilleNumber(chordSymbol, key, chart.mode), userEdited: true };
    }) })) })),
  };
}

export function normalizedChart(chart: SongChart): SongChart {
  const numerator = Number(chart.timeSignature.split("/")[0]) || 4;
  return {
    ...chart,
    sections: [...chart.sections].sort((a, b) => a.order - b.order).map((section, sectionIndex) => ({
      ...section, order: sectionIndex + 1,
      measures: [...section.measures].sort((a, b) => a.number - b.number).map((measure, measureIndex) => ({
        ...measure, number: measureIndex + 1, beats: numerator,
        chordEvents: [...measure.chordEvents].filter(event => event.beat >= 1 && event.beat <= numerator).sort((a, b) => a.beat - b.beat).map(event => ({ ...event, nashvilleNumber: nashvilleNumber(event.chordSymbol, chart.key, chart.mode) })),
      })),
    })),
  };
}

export function sectionLoopWindow(section: SongSection) { return { start: section.startTime, end: Math.max(section.startTime, section.endTime) }; }

export function loadPrivateCharts(storage: Pick<Storage, "getItem">): SongChart[] {
  try { const value = storage.getItem(PRIVATE_LIBRARY_KEY); return value ? JSON.parse(value) : []; } catch { return []; }
}

export function savePrivateCharts(storage: Pick<Storage, "setItem">, charts: SongChart[]) { storage.setItem(PRIVATE_LIBRARY_KEY, JSON.stringify(charts.map(normalizedChart))); }
