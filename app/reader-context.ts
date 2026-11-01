import { identifyChord } from './chord-reader.ts';
import { parseChordParts, spellChordInKey } from './music-theory.ts';

export type ReaderKey = { tonic: number; mode: 'major' | 'minor'; name: string };
type Chord = { symbol: string; root: number; bass: number; quality: 'major' | 'minor' | 'diminished' | 'suspended'; dominant: boolean; seventh: boolean; halfDiminished: boolean; inferred: boolean };
type Observation = { notes: number[]; pitches: number[]; chords: Chord[] };
export type ReaderFunction = { chord: string; roman: string; number: string; role: string; bass: string };
export type ReaderContext = {
  key: ReaderKey | null;
  confidence: 'Listening' | 'Tentative' | 'Likely' | 'Strong estimate';
  alternative: string;
  current: ReaderFunction | null;
  progression: ReaderFunction[];
  observations: number;
};

const pc = (n: number) => ((n % 12) + 12) % 12;
const MAJOR_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PROFILES = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
const ROMANS = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
const NUMBERS = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'];
const emptyContext = (): ReaderContext => ({ key: null, confidence: 'Listening', alternative: '', current: null, progression: [], observations: 0 });

function observe(notes: number[]): Observation {
  const result = identifyChord(notes);
  const pitches = [...new Set(result.notes.map(pc))];
  const chords = result.matches.slice(0, 8).map(symbol => {
    const { root, suffix } = parseChordParts(symbol);
    const diminished = /dim|♭5/.test(suffix) && /dim|^m/.test(suffix);
    const minor = /^m(?!aj)/.test(suffix);
    const suspended = /sus|^5$/.test(suffix);
    return {
      symbol, root: root.pitchClass, bass: result.notes[0] % 12,
      quality: diminished ? 'diminished' as const : minor ? 'minor' as const : suspended ? 'suspended' as const : 'major' as const,
      dominant: /^(?:7|9|11|13)/.test(suffix),
      seventh: /7|9|11|13/.test(suffix) && !/add|6\/9/.test(suffix),
      halfDiminished: diminished && minor,
      inferred: result.inferredRoots.includes(symbol),
    };
  });
  return { notes: result.notes, pitches, chords };
}

function expectedQuality(degree: number, mode: ReaderKey['mode']): Chord['quality'] | undefined {
  const qualities: Record<number, Chord['quality']> = mode === 'major'
    ? { 0: 'major', 2: 'minor', 4: 'minor', 5: 'major', 7: 'major', 9: 'minor', 11: 'diminished' }
    : { 0: 'minor', 2: 'diminished', 3: 'major', 5: 'minor', 7: 'major', 8: 'major', 10: 'major', 11: 'diminished' };
  return qualities[degree];
}

function chordFit(chord: Chord, key: ReaderKey) {
  const degree = pc(chord.root - key.tonic);
  const expected = expectedQuality(degree, key.mode);
  if (chord.dominant && degree === 7) return 3.6;
  if (chord.quality === expected && !chord.dominant) return degree === 0 ? 3.1 : 2.4;
  if (chord.quality === 'suspended' && expected) return 1.4;
  // Natural-minor v, blues I7/IV7, and modal mixture remain plausible context.
  if (key.mode === 'minor' && degree === 7 && chord.quality === 'minor') return 2;
  if (chord.dominant && (degree === 0 || degree === 5)) return 1;
  if (key.mode === 'major' && ((degree === 5 && chord.quality === 'minor') || ([3, 8, 10].includes(degree) && chord.quality === 'major'))) return .8;
  if (chord.dominant && (key.mode === 'major' ? MAJOR : MINOR).includes(pc(degree + 5))) return .65;
  return -.8;
}

function chooseChord(event: Observation, key: ReaderKey): Chord | undefined {
  return event.chords.map((chord, index) => ({ chord, score: chordFit(chord, key) - index * .23 - (chord.inferred ? .5 : 0) }))
    .sort((a, b) => b.score - a.score)[0]?.chord;
}

function correlation(chroma: number[], key: ReaderKey) {
  const profile = PROFILES[key.mode];
  const mean = chroma.reduce((a, b) => a + b, 0) / 12;
  const profileMean = profile.reduce((a, b) => a + b, 0) / 12;
  let numerator = 0, variance = 0, profileVariance = 0;
  for (let i = 0; i < 12; i++) {
    const a = chroma[pc(i + key.tonic)] - mean, b = profile[i] - profileMean;
    numerator += a * b; variance += a * a; profileVariance += b * b;
  }
  return variance > 1e-10 ? numerator / Math.sqrt(variance * profileVariance) : 0;
}

function rankKeys(events: Observation[]) {
  const chroma = Array<number>(12).fill(0);
  const weights = events.map((_, index) => Math.pow(.86, events.length - index - 1));
  events.forEach((event, index) => {
    const weight = weights[index] * (event.pitches.length >= 3 ? 1 : .55);
    event.pitches.forEach(pitch => { chroma[pitch] += weight / event.pitches.length; });
    if (event.chords.length || event.pitches.length === 1) chroma[event.notes[0] % 12] += weight * .12;
  });
  return (['major', 'minor'] as const).flatMap(mode => MAJOR_NAMES.map((_, tonic) => {
    const key: ReaderKey = { tonic, mode, name: `${(mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[tonic]} ${mode}` };
    const choices = events.map(event => chooseChord(event, key));
    let harmony = 0, total = 0, cadence = 0, tonicCadence = false;
    choices.forEach((chord, index) => {
      if (!chord) return;
      harmony += chordFit(chord, key) * weights[index]; total += weights[index];
      const previous = choices[index - 1];
      if (!previous) return;
      const degree = pc(chord.root - tonic), previousDegree = pc(previous.root - tonic);
      const isTonic = degree === 0 && chord.quality === expectedQuality(0, mode);
      if (isTonic && previousDegree === 7 && (previous.dominant || previous.quality === 'major')) {
        cadence += 3.8 * weights[index]; tonicCadence = true;
        const before = choices[index - 2];
        if (before && pc(before.root - tonic) === 2 && ['minor', 'diminished'].includes(before.quality)) cadence += 1.6 * weights[index];
      } else if (isTonic && previousDegree === 5 && previous.quality === expectedQuality(5, mode)) {
        cadence += 1.7 * weights[index];
      }
      // A dominant resolving inside a key supports tonicization without declaring a modulation.
      if (previous.dominant && pc(previous.root + 5) === chord.root && expectedQuality(degree, mode) === chord.quality) cadence += .45 * weights[index];
    });
    const melody = events.slice(-3);
    if (melody.length === 3 && melody.every(event => event.pitches.length === 1)) {
      const degrees = melody.map(event => pc(event.pitches[0] - tonic));
      if (degrees[0] === (mode === 'major' ? 4 : 3) && degrees[1] === 2 && degrees[2] === 0) cadence += .9;
    }
    const pitchFit = correlation(chroma, key);
    return { key, pitchFit, tonicCadence, score: 2.2 * pitchFit + (total ? harmony / total : 0) + Math.min(5, cadence) };
  })).sort((a, b) => b.score - a.score);
}

function roman(chord: Chord, degree: number) {
  const base = chord.quality === 'minor' || chord.quality === 'diminished' ? ROMANS[degree].toLowerCase() : ROMANS[degree];
  if (chord.quality === 'diminished') return base + (chord.halfDiminished ? 'ø7' : chord.seventh ? '°7' : '°');
  if (chord.quality === 'suspended') return base + (chord.seventh ? '7sus' : 'sus');
  return base + (chord.seventh ? /maj/.test(chord.symbol) ? 'maj7' : '7' : '');
}

export function describeReaderChord(symbol: string, key: ReaderKey): ReaderFunction {
  // All symbols here originate in the chord reader; this also keeps the pure function useful in tests.
  const parts = parseChordParts(symbol);
  const suffix = parts.suffix;
  const minor = /^m(?!aj)/.test(suffix), diminished = /dim|♭5/.test(suffix) && /dim|^m/.test(suffix);
  const chord: Chord = { symbol, root: parts.root.pitchClass, bass: parts.slashBass?.pitchClass ?? parts.root.pitchClass,
    quality: diminished ? 'diminished' : minor ? 'minor' : /sus|^5$/.test(suffix) ? 'suspended' : 'major',
    dominant: /^(7|9|11|13)/.test(suffix), seventh: /7|9|11|13/.test(suffix) && !/add|6\/9/.test(suffix), halfDiminished: diminished && minor, inferred: false };
  const degree = pc(chord.root - key.tonic);
  let functionRoman = roman(chord, degree), number = NUMBERS[degree];
  let role = degree === 0 ? 'Tonic · home' : degree === 7 ? 'Dominant · leads home' : degree === 2 ? 'Predominant · prepares the 5' : degree === 5 ? 'Subdominant' : 'Diatonic harmony';
  const targetDegree = pc(degree + 5);
  if (chord.dominant && degree === 1) {
    functionRoman = 'subV7/I'; role = 'Tritone substitute · leads home';
  } else if (chord.dominant && degree !== 7 && expectedQuality(targetDegree, key.mode)) {
    const target = expectedQuality(targetDegree, key.mode) === 'minor' ? ROMANS[targetDegree].toLowerCase() : ROMANS[targetDegree];
    functionRoman = `V7/${target}`; number = `5 of ${NUMBERS[targetDegree]}`;
    role = `Secondary dominant · leads to the ${NUMBERS[targetDegree]}`;
  } else if (chord.quality !== expectedQuality(degree, key.mode) && chord.quality !== 'suspended' && !(key.mode === 'minor' && degree === 7 && chord.quality === 'minor')) {
    const borrowed = key.mode === 'major' && ((degree === 5 && chord.quality === 'minor') || ([3, 8, 10].includes(degree) && chord.quality === 'major' && !chord.dominant));
    role = borrowed ? 'Borrowed harmony · from parallel minor' : 'Chromatic / altered harmony';
  }
  const tonicName = key.name.split(' ')[0];
  // Minor-key spelling uses the relative major to preserve its signature.
  const spellingKey = key.mode === 'minor' ? MAJOR_NAMES[pc(key.tonic + 3)] : tonicName;
  return { chord: spellChordInKey(symbol, spellingKey), roman: functionRoman, number, role, bass: NUMBERS[pc(chord.bass - key.tonic)] };
}

/** Space belongs to analysis while the reader surface is focused; native controls keep their shortcuts. */
export function readerContextShortcut(event: { key: string; code?: string; repeat?: boolean; defaultPrevented?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, interactive: boolean, dialogOpen: boolean) {
  return (event.code === 'Space' || event.key === ' ') && !event.repeat && !event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !interactive && !dialogOpen;
}

/** Collect stable sounding harmony, including pedal-held notes, without counting release fragments. */
export class ReaderContextDetector {
  running = false;
  result = emptyContext();
  private events: Observation[] = [];
  private previous: number[] = [];
  private pending: { notes: number[]; since: number } | null = null;
  private total = 0;
  private key: ReaderKey | null = null;

  start(notes: readonly number[], now: number) {
    this.running = true; this.events = []; this.previous = []; this.pending = null; this.total = 0; this.key = null;
    this.result = emptyContext(); this.update(notes, now);
    return this.result;
  }
  update(notes: readonly number[], now: number) {
    if (!this.running) return this.result;
    const clean = [...new Set(notes.filter(n => Number.isInteger(n) && n >= 0 && n <= 127))].sort((a, b) => a - b);
    if (clean.join(',') === this.previous.join(',')) return this.result;
    this.tick(now);
    const attack = clean.some(note => !this.previous.includes(note));
    this.pending = attack ? { notes: clean, since: now } : null;
    this.previous = clean;
    return this.result;
  }
  tick(now: number) {
    if (this.running && this.pending && now - this.pending.since >= 90) {
      const event = observe(this.pending.notes); this.pending = null;
      this.events.push(event); this.events = this.events.slice(-24); this.total++;
      this.analyze();
    }
    return this.result;
  }
  stop(now: number) {
    this.tick(now); this.running = false; this.pending = null; this.previous = [];
    return this.result;
  }
  private analyze() {
    const ranked = rankKeys(this.events);
    let best = ranked[0];
    const previous = this.key && ranked.find(candidate => candidate.key.tonic === this.key?.tonic && candidate.key.mode === this.key?.mode);
    if (previous && best.score - previous.score < .35) best = previous;
    const runnerUp = ranked.find(candidate => candidate !== best)!;
    const pitches = new Set(this.events.flatMap(event => event.pitches));
    const distinctChords = new Set(this.events.flatMap(event => event.chords[0] ? [event.chords[0].symbol] : []));
    const sufficient = pitches.size >= 3 && (best.pitchFit > .38 || (distinctChords.size >= 2 && best.score > 3));
    if (!sufficient) {
      this.result = { ...emptyContext(), observations: this.total }; return;
    }
    const margin = best.score - runnerUp.score;
    const confidence = distinctChords.size >= 3 && margin > .8 && best.tonicCadence ? 'Strong estimate'
      : (distinctChords.size >= 3 || this.events.length >= 8) && margin > .4 ? 'Likely' : 'Tentative';
    this.key = best.key;
    const functions = this.events.map(event => {
      const chord = chooseChord(event, best.key);
      return chord ? describeReaderChord(chord.symbol, best.key) : null;
    });
    const progression = functions.filter((f): f is ReaderFunction => Boolean(f)).filter((f, i, all) => i === 0 || f.chord !== all[i - 1].chord).slice(-6);
    this.result = { key: best.key, confidence, alternative: runnerUp.key.name, current: functions.at(-1) ?? null, progression, observations: this.total };
  }
}
