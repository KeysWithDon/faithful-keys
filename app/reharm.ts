import { parseChordParts, parseChordRoot, spellRomanDegree } from "./music-theory.ts";

export type HarmonicFunction = "T" | "PD" | "D" | "other";

export type ReharmPlan = {
  chords: string[];
  durations: number[];
  changedIndex: number | null;
  function: HarmonicFunction | null;
};

function normalizedSuffix(chord: string) {
  return parseChordParts(chord).suffix.replace(/\s/g, "").toLowerCase();
}

function isDominantColor(chord: string) {
  const suffix = normalizedSuffix(chord);
  return suffix.includes("dim") || suffix.includes("sus") || /^(?:7|9|11|13|6\/9)/.test(suffix);
}

function pitchDistance(chord: string, tonic: string) {
  return (parseChordRoot(chord).root.pitchClass - parseChordRoot(tonic).root.pitchClass + 12) % 12;
}

/** Classifies the familiar tonic → predominant → dominant cadence roles. */
export function harmonicFunction(chord: string, tonic: string): HarmonicFunction {
  if (isDominantColor(chord)) return "D";
  const degree = pitchDistance(chord, tonic);
  if ([0, 4, 9].includes(degree)) return "T";
  if ([2, 5].includes(degree)) return "PD";
  if ([7, 11].includes(degree)) return "D";
  return "other";
}

function sameChord(a: string, b: string) {
  const aParts = parseChordParts(a);
  const bParts = parseChordParts(b);
  return aParts.root.pitchClass === bParts.root.pitchClass
    && normalizedSuffix(a) === normalizedSuffix(b)
    && aParts.slashBass?.pitchClass === bParts.slashBass?.pitchClass;
}

function firstDifferent(source: string, choices: string[]) {
  return choices.find(choice => !sameChord(source, choice)) ?? source;
}

function symbol(root: string, quality: "major" | "minor" | "dominant" | "diminished", sevenths: boolean) {
  if (quality === "major") return sevenths ? `${root}maj7` : root;
  if (quality === "minor") return sevenths ? `${root}m7` : `${root}m`;
  if (quality === "diminished") return sevenths ? `${root}dim7` : `${root}dim`;
  return sevenths ? `${root}7` : root;
}

function roleVisit(turn: number, role: HarmonicFunction) {
  const plan: HarmonicFunction[] = ["PD", "D", "T", "D", "PD"];
  const cycle = Math.floor(turn / plan.length);
  const turnPosition = turn % plan.length;
  return cycle * plan.filter(item => item === role).length
    + plan.slice(0, turnPosition).filter(item => item === role).length;
}

/**
 * Reharmonizes one purposeful point from the original chart on each turn.
 * It rotates through PD, D, and T choices so a cadence keeps its direction
 * instead of receiving unrelated chord-name substitutions.
 */
export function buildFunctionReharm(
  sourceChords: string[],
  sourceDurations: number[],
  tonic: string,
  turn: number,
  sevenths = true,
): ReharmPlan {
  const eligible = sourceChords
    .map((chord, index) => ({ chord, index, role: harmonicFunction(chord, tonic) }))
    .filter(({ index }) => index < sourceChords.length - 1 && (sourceDurations[index] ?? 0) >= 1);
  if (!eligible.length) return { chords: [...sourceChords], durations: [...sourceDurations], changedIndex: null, function: null };

  const preference: HarmonicFunction[] = ["PD", "D", "T", "D", "PD"];
  const desiredRole = preference[turn % preference.length];
  const roleCandidates = eligible.filter(candidate => candidate.role === desiredRole);
  const selected = roleCandidates[roleVisit(turn, desiredRole) % Math.max(1, roleCandidates.length)]
    ?? eligible[turn % eligible.length];
  const next = sourceChords[selected.index + 1];
  const nextRoot = parseChordRoot(next).root.display;
  const nextRole = harmonicFunction(next, tonic);
  const localVisit = roleVisit(turn, selected.role);
  const degree = (value: 1 | 2 | 3 | 4 | 5 | 6 | 7, alteration = 0) => spellRomanDegree(tonic, value, alteration);

  let choices: string[];
  if (selected.role === "T") {
    const secondary = symbol(spellRomanDegree(nextRoot, 5), "dominant", sevenths);
    const passingDiminished = symbol(spellRomanDegree(nextRoot, 7), "diminished", sevenths);
    choices = [
      symbol(degree(6), "minor", sevenths),
      symbol(degree(3), "minor", sevenths),
      `${degree(1)}/${degree(3)}`,
      ...(nextRole === "PD" ? [secondary, passingDiminished] : [passingDiminished, secondary]),
    ];
  } else if (selected.role === "PD") {
    choices = [
      symbol(degree(2), "minor", sevenths),
      symbol(degree(4), "minor", sevenths),
      symbol(degree(4), "major", sevenths),
    ];
  } else {
    // Dominant color is always built for the chord that follows it. This is
    // what keeps a tritone or leading diminished chord pointed at its target.
    choices = [
      symbol(spellRomanDegree(nextRoot, 2, -1), "dominant", sevenths),
      symbol(spellRomanDegree(nextRoot, 7), "diminished", sevenths),
      symbol(spellRomanDegree(nextRoot, 5), "dominant", sevenths),
    ];
  }

  const rotated = choices.slice(localVisit % choices.length).concat(choices.slice(0, localVisit % choices.length));
  const replacement = firstDifferent(selected.chord, rotated);
  const chords = [...sourceChords];
  chords[selected.index] = replacement;
  return { chords, durations: [...sourceDurations], changedIndex: selected.index, function: selected.role };
}
