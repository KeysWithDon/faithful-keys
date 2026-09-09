export type EarTrainingDifficulty = "easy" | "hard";
export type IntervalPlaybackMode = "ascending" | "descending" | "harmonic" | "ascending-harmonic" | "descending-harmonic";
export type EarTrainingSubject = "intervals" | "scales";
export type ScaleDifficulty = "beginnerIntermediate" | "advancedHighlyAdvanced";
export type ScalePlaybackDirection = "ascending" | "descending" | "ascending-descending" | "random";

export type ScaleDefinition = {
  id: string;
  name: string;
  aliases: string[];
  difficulties: ScaleDifficulty[];
  family: "core" | "majorModes" | "symmetrical" | "melodicMinorModes" | "harmonicMinorModes";
  intervalOffsets: number[];
  formula: string[];
  description: string;
};

export type ScaleQuestion = {
  scale: ScaleDefinition;
  rootPitchClass: number;
  rootName: string;
  direction: Exclude<ScalePlaybackDirection, "random">;
  ascendingMidis: number[];
};

export type IntervalDefinition = {
  id: string;
  name: string;
  semitones: number;
  difficulty: EarTrainingDifficulty;
};

export type IntervalPerformance = {
  presented: number;
  wrongGuesses: number;
  firstTryCorrect: number;
};

export type IntervalQuestion = {
  interval: IntervalDefinition;
  rootMidi: number;
  targetMidi: number;
};

const INTERVAL_NAMES = [
  "Unison", "Minor 2nd", "Major 2nd", "Minor 3rd", "Major 3rd", "Perfect 4th", "Tritone",
  "Perfect 5th", "Minor 6th", "Major 6th", "Minor 7th", "Major 7th", "Octave", "Minor 9th",
  "Major 9th", "Minor 10th", "Major 10th", "Perfect 11th", "Diminished 12th", "Perfect 12th",
  "Minor 13th", "Major 13th", "Minor 14th", "Major 14th", "Double Octave",
] as const;

export const INTERVALS: IntervalDefinition[] = INTERVAL_NAMES.map((name, semitones) => ({
  id: `interval-${semitones}`,
  name,
  semitones,
  difficulty: semitones <= 12 ? "easy" : "hard",
}));

export const TEST_LENGTHS = [10, 15, 25, 50] as const;

export type CircleDirection = "fourths" | "fifths";
export type IntervalDirection = "up" | "down";

export const CIRCLE_PITCH_CLASSES: Record<CircleDirection, number[]> = {
  fourths: [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7],
  fifths: [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5],
};

export const CIRCLE_NOTE_NAMES: Record<CircleDirection, string[]> = {
  fourths: ["C", "F", "B♭", "E♭", "A♭", "D♭", "G♭", "B", "E", "A", "D", "G"],
  fifths: ["C", "G", "D", "A", "E", "B", "F♯", "C♯", "G♯", "D♯", "A♯", "F"],
};

export const PITCH_CLASS_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"] as const;

const BOTH_LEVELS: ScaleDifficulty[] = ["beginnerIntermediate", "advancedHighlyAdvanced"];

export const SCALES: ScaleDefinition[] = [
  { id: "major", name: "Major", aliases: ["Ionian"], difficulties: ["beginnerIntermediate"], family: "core", intervalOffsets: [0, 2, 4, 5, 7, 9, 11], formula: ["1", "2", "3", "4", "5", "6", "7"], description: "Bright, stable major sound." },
  { id: "natural-minor", name: "Natural Minor", aliases: ["Aeolian"], difficulties: ["beginnerIntermediate"], family: "core", intervalOffsets: [0, 2, 3, 5, 7, 8, 10], formula: ["1", "2", "♭3", "4", "5", "♭6", "♭7"], description: "Traditional minor sound." },
  { id: "harmonic-minor", name: "Harmonic Minor", aliases: [], difficulties: BOTH_LEVELS, family: "harmonicMinorModes", intervalOffsets: [0, 2, 3, 5, 7, 8, 11], formula: ["1", "2", "♭3", "4", "5", "♭6", "7"], description: "Minor scale with a major 7th, creating strong dominant tension." },
  { id: "melodic-minor", name: "Melodic Minor", aliases: ["Jazz Minor"], difficulties: BOTH_LEVELS, family: "melodicMinorModes", intervalOffsets: [0, 2, 3, 5, 7, 9, 11], formula: ["1", "2", "♭3", "4", "5", "6", "7"], description: "Minor scale with natural 6 and 7 in both directions." },
  { id: "major-pentatonic", name: "Major Pentatonic", aliases: [], difficulties: ["beginnerIntermediate"], family: "core", intervalOffsets: [0, 2, 4, 7, 9], formula: ["1", "2", "3", "5", "6"], description: "Open major sound common in gospel, pop, country, and soul." },
  { id: "minor-pentatonic", name: "Minor Pentatonic", aliases: [], difficulties: ["beginnerIntermediate"], family: "core", intervalOffsets: [0, 3, 5, 7, 10], formula: ["1", "♭3", "4", "5", "♭7"], description: "Strong, familiar minor sound used across blues, rock, gospel, and soul." },
  { id: "major-blues", name: "Major Blues", aliases: [], difficulties: ["beginnerIntermediate"], family: "core", intervalOffsets: [0, 2, 3, 4, 7, 9], formula: ["1", "2", "♭3", "3", "5", "6"], description: "Major pentatonic color with a passing blue note." },
  { id: "minor-blues", name: "Minor Blues", aliases: [], difficulties: ["beginnerIntermediate"], family: "core", intervalOffsets: [0, 3, 5, 6, 7, 10], formula: ["1", "♭3", "4", "♭5", "5", "♭7"], description: "Minor pentatonic sound with the expressive flattened 5th." },
  { id: "dorian", name: "Dorian", aliases: [], difficulties: ["beginnerIntermediate"], family: "majorModes", intervalOffsets: [0, 2, 3, 5, 7, 9, 10], formula: ["1", "2", "♭3", "4", "5", "6", "♭7"], description: "Minor sound with a natural 6th. Common in gospel, jazz, funk, and soul." },
  { id: "mixolydian", name: "Mixolydian", aliases: [], difficulties: ["beginnerIntermediate"], family: "majorModes", intervalOffsets: [0, 2, 4, 5, 7, 9, 10], formula: ["1", "2", "3", "4", "5", "6", "♭7"], description: "Major sound with a ♭7. Common over dominant chords." },
  { id: "lydian", name: "Lydian", aliases: [], difficulties: ["beginnerIntermediate"], family: "majorModes", intervalOffsets: [0, 2, 4, 6, 7, 9, 11], formula: ["1", "2", "3", "♯4", "5", "6", "7"], description: "Major sound with a raised 4th, creating an open or floating quality." },
  { id: "phrygian", name: "Phrygian", aliases: [], difficulties: ["beginnerIntermediate"], family: "majorModes", intervalOffsets: [0, 1, 3, 5, 7, 8, 10], formula: ["1", "♭2", "♭3", "4", "5", "♭6", "♭7"], description: "Dark minor sound characterized by a ♭2." },
  { id: "locrian", name: "Locrian", aliases: [], difficulties: ["beginnerIntermediate"], family: "majorModes", intervalOffsets: [0, 1, 3, 5, 6, 8, 10], formula: ["1", "♭2", "♭3", "4", "♭5", "♭6", "♭7"], description: "Diminished sound characterized by ♭2 and ♭5." },
  { id: "chromatic", name: "Chromatic", aliases: [], difficulties: ["advancedHighlyAdvanced"], family: "symmetrical", intervalOffsets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], formula: ["All 12 chromatic notes"], description: "Every pitch in the octave, moving by half steps." },
  { id: "whole-tone", name: "Whole Tone", aliases: [], difficulties: ["advancedHighlyAdvanced"], family: "symmetrical", intervalOffsets: [0, 2, 4, 6, 8, 10], formula: ["1", "2", "3", "♯4", "♯5", "♭7"], description: "Symmetrical augmented sound." },
  { id: "half-whole-diminished", name: "Half-Whole Diminished", aliases: ["Dominant Diminished"], difficulties: ["advancedHighlyAdvanced"], family: "symmetrical", intervalOffsets: [0, 1, 3, 4, 6, 7, 9, 10], formula: ["H", "W", "H", "W", "H", "W", "H", "W"], description: "Dominant diminished sound containing multiple altered tensions." },
  { id: "whole-half-diminished", name: "Whole-Half Diminished", aliases: ["Diminished"], difficulties: ["advancedHighlyAdvanced"], family: "symmetrical", intervalOffsets: [0, 2, 3, 5, 6, 8, 9, 11], formula: ["W", "H", "W", "H", "W", "H", "W", "H"], description: "Symmetrical sound built to outline a diminished seventh chord." },
  { id: "dorian-flat-2", name: "Dorian ♭2", aliases: ["Phrygian ♮6"], difficulties: ["advancedHighlyAdvanced"], family: "melodicMinorModes", intervalOffsets: [0, 1, 3, 5, 7, 9, 10], formula: ["1", "♭2", "♭3", "4", "5", "6", "♭7"], description: "Dorian color darkened by a flattened 2nd." },
  { id: "lydian-augmented", name: "Lydian Augmented", aliases: [], difficulties: ["advancedHighlyAdvanced"], family: "melodicMinorModes", intervalOffsets: [0, 2, 4, 6, 8, 9, 11], formula: ["1", "2", "3", "♯4", "♯5", "6", "7"], description: "Lydian brightness with an augmented 5th." },
  { id: "lydian-dominant", name: "Lydian Dominant", aliases: ["Overtone"], difficulties: ["advancedHighlyAdvanced"], family: "melodicMinorModes", intervalOffsets: [0, 2, 4, 6, 7, 9, 10], formula: ["1", "2", "3", "♯4", "5", "6", "♭7"], description: "Dominant sound with a raised 4th." },
  { id: "mixolydian-flat-6", name: "Mixolydian ♭6", aliases: ["Aeolian Dominant"], difficulties: ["advancedHighlyAdvanced"], family: "melodicMinorModes", intervalOffsets: [0, 2, 4, 5, 7, 8, 10], formula: ["1", "2", "3", "4", "5", "♭6", "♭7"], description: "Dominant sound with a darker flattened 6th." },
  { id: "locrian-natural-2", name: "Locrian ♮2", aliases: ["Half-Diminished"], difficulties: ["advancedHighlyAdvanced"], family: "melodicMinorModes", intervalOffsets: [0, 2, 3, 5, 6, 8, 10], formula: ["1", "2", "♭3", "4", "♭5", "♭6", "♭7"], description: "Locrian sound softened by a natural 2nd." },
  { id: "altered", name: "Altered", aliases: ["Super Locrian"], difficulties: ["advancedHighlyAdvanced"], family: "melodicMinorModes", intervalOffsets: [0, 1, 3, 4, 6, 8, 10], formula: ["1", "♭9", "♯9", "3", "♭5", "♯5", "♭7"], description: "Highly tense dominant sound emphasizing altered extensions." },
  { id: "locrian-natural-6", name: "Locrian ♮6", aliases: [], difficulties: ["advancedHighlyAdvanced"], family: "harmonicMinorModes", intervalOffsets: [0, 1, 3, 5, 6, 9, 10], formula: ["1", "♭2", "♭3", "4", "♭5", "6", "♭7"], description: "Locrian color distinguished by a natural 6th." },
  { id: "ionian-augmented", name: "Ionian Augmented", aliases: [], difficulties: ["advancedHighlyAdvanced"], family: "harmonicMinorModes", intervalOffsets: [0, 2, 4, 5, 8, 9, 11], formula: ["1", "2", "3", "4", "♯5", "6", "7"], description: "Major sound with an augmented 5th." },
  { id: "dorian-sharp-4", name: "Dorian ♯4", aliases: ["Romanian Minor"], difficulties: ["advancedHighlyAdvanced"], family: "harmonicMinorModes", intervalOffsets: [0, 2, 3, 6, 7, 9, 10], formula: ["1", "2", "♭3", "♯4", "5", "6", "♭7"], description: "Dorian sound sharpened by an expressive raised 4th." },
  { id: "phrygian-dominant", name: "Phrygian Dominant", aliases: ["Spanish Phrygian"], difficulties: ["advancedHighlyAdvanced"], family: "harmonicMinorModes", intervalOffsets: [0, 1, 4, 5, 7, 8, 10], formula: ["1", "♭2", "3", "4", "5", "♭6", "♭7"], description: "Dominant sound with a distinctive flattened 2nd and 6th." },
  { id: "lydian-sharp-2", name: "Lydian ♯2", aliases: [], difficulties: ["advancedHighlyAdvanced"], family: "harmonicMinorModes", intervalOffsets: [0, 3, 4, 6, 7, 9, 11], formula: ["1", "♯2", "3", "♯4", "5", "6", "7"], description: "Lydian sound with both a raised 2nd and raised 4th." },
  { id: "altered-diminished", name: "Altered Diminished", aliases: ["Super Locrian ♭♭7"], difficulties: ["advancedHighlyAdvanced"], family: "harmonicMinorModes", intervalOffsets: [0, 1, 3, 4, 6, 8, 9], formula: ["1", "♭2", "♭3", "♭4", "♭5", "♭6", "♭♭7"], description: "An altered dominant sound resolving through a diminished 7th." },
];

const FLAT_NOTE_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const SHARP_NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const SCALE_ROOT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"] as const;

export function scalesForDifficulty(difficulty: ScaleDifficulty) {
  return SCALES.filter(scale => scale.difficulties.includes(difficulty));
}

export function scaleNoteNames(scale: ScaleDefinition, rootPitchClass: number, writtenRoot?: string) {
  const root = writtenRoot ?? SCALE_ROOT_NAMES[((rootPitchClass % 12) + 12) % 12];
  const preferSharps = root.includes("♯") || ["E", "B"].includes(root);
  const names = preferSharps ? SHARP_NOTE_NAMES : FLAT_NOTE_NAMES;
  return [...scale.intervalOffsets, 12].map(offset => names[(rootPitchClass + offset) % 12]);
}

export function createScaleQuestion(
  scale: ScaleDefinition,
  rootPitchClass: number,
  direction: ScalePlaybackDirection,
  randomValue = Math.random(),
): ScaleQuestion {
  const normalizedRoot = ((rootPitchClass % 12) + 12) % 12;
  const resolvedDirection = direction === "random"
    ? (["ascending", "descending", "ascending-descending"] as const)[Math.min(2, Math.floor(Math.max(0, randomValue) * 3))]
    : direction;
  const rootMidi = 60 + normalizedRoot;
  return {
    scale,
    rootPitchClass: normalizedRoot,
    rootName: SCALE_ROOT_NAMES[normalizedRoot],
    direction: resolvedDirection,
    ascendingMidis: [...scale.intervalOffsets.map(offset => rootMidi + offset), rootMidi + 12],
  };
}

export function scalePlaybackMidis(question: ScaleQuestion) {
  if (question.direction === "descending") return [...question.ascendingMidis].reverse();
  if (question.direction === "ascending-descending") return [...question.ascendingMidis, ...question.ascendingMidis.slice(0, -1).reverse()];
  return question.ascendingMidis;
}

export function createRandomScaleQuestion(
  pool: ScaleDefinition[],
  direction: ScalePlaybackDirection,
  recentScaleIds: string[],
  recentRoots: number[],
  random = Math.random,
) {
  if (pool.length < 1) throw new Error("A scale pool is required.");
  let scale = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  for (let tries = 0; tries < 5 && recentScaleIds.at(-1) === scale.id && pool.length > 1; tries += 1) {
    scale = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  }
  let root = Math.min(11, Math.floor(random() * 12));
  for (let tries = 0; tries < 5 && recentRoots.slice(-2).includes(root); tries += 1) root = Math.min(11, Math.floor(random() * 12));
  return createScaleQuestion(scale, root, direction, random());
}

export function createCircleIntervalQuestion(
  interval: IntervalDefinition,
  pitchClass: number,
  direction: IntervalDirection,
): IntervalQuestion {
  const normalizedPitchClass = ((pitchClass % 12) + 12) % 12;
  if (direction === "up") {
    const rootMidi = 48 + normalizedPitchClass;
    return { interval, rootMidi, targetMidi: rootMidi + interval.semitones };
  }
  const startingMidi = 72 + normalizedPitchClass;
  return { interval, rootMidi: startingMidi - interval.semitones, targetMidi: startingMidi };
}

export function intervalsForDifficulty(difficulty: EarTrainingDifficulty) {
  return difficulty === "easy" ? INTERVALS.slice(0, 13) : INTERVALS;
}

export function calculateAccuracy(correctAnswers: number, totalAttempts: number) {
  return totalAttempts > 0 ? correctAnswers / totalAttempts * 100 : 0;
}

export function formatAccuracy(correctAnswers: number, totalAttempts: number) {
  return `${calculateAccuracy(correctAnswers, totalAttempts).toFixed(1)}%`;
}

export function isTestComplete(completedIntervals: number, targetIntervals: number) {
  return completedIntervals >= targetIntervals;
}

export function createIntervalQuestion(interval: IntervalDefinition, randomValue = Math.random(), lowMidi = 48, highMidi = 84): IntervalQuestion {
  const highestRoot = highMidi - interval.semitones;
  if (highestRoot < lowMidi) throw new Error(`${interval.name} does not fit the keyboard range.`);
  const rootCount = highestRoot - lowMidi + 1;
  const rootMidi = lowMidi + Math.min(rootCount - 1, Math.floor(Math.max(0, randomValue) * rootCount));
  return { interval, rootMidi, targetMidi: rootMidi + interval.semitones };
}

export function chooseWeightedInterval(
  pool: IntervalDefinition[],
  performance: Record<string, IntervalPerformance>,
  recentIntervalIds: string[],
  randomValue = Math.random(),
) {
  if (!pool.length) throw new Error("An interval pool is required.");
  const weighted = pool.map(interval => {
    const record = performance[interval.id];
    const weakness = record ? Math.min(1.25, record.wrongGuesses / Math.max(1, record.presented) * .32) : 0;
    const repeatPenalty = recentIntervalIds.at(-1) === interval.id ? .2 : recentIntervalIds.slice(-3).includes(interval.id) ? .62 : 1;
    return { interval, weight: (1 + weakness) * repeatPenalty };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.max(0, Math.min(.999999, randomValue)) * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor < 0) return item.interval;
  }
  return weighted.at(-1)!.interval;
}

export function createRandomQuestion(
  difficulty: EarTrainingDifficulty,
  performance: Record<string, IntervalPerformance>,
  recentIntervalIds: string[],
  recentRoots: number[],
  random = Math.random,
) {
  const interval = chooseWeightedInterval(intervalsForDifficulty(difficulty), performance, recentIntervalIds, random());
  let question = createIntervalQuestion(interval, random());
  for (let tries = 0; tries < 5 && recentRoots.slice(-2).includes(question.rootMidi); tries += 1) {
    question = createIntervalQuestion(interval, random());
  }
  return question;
}
