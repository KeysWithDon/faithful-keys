export type EarTrainingDifficulty = "easy" | "hard";
export type IntervalPlaybackMode = "ascending" | "descending" | "harmonic" | "ascending-harmonic" | "descending-harmonic";

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
