import { parseSpelledNote, spellRomanDegree } from "./music-theory.ts";
import { chordBankForKey, type ChordBankChoice } from "./song-analyzer.ts";

export type CustomProgressionStyle = "gospel" | "jazz" | "ccm" | "worship";

export type GeneratedCustomProgression = {
  chords: string[];
  durations: number[];
  establishedKey: string;
  modulated: boolean;
  returnedHome: boolean;
};

type Mode = "major" | "minor";
type RandomSource = () => number;

const APP_KEYS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

const STYLE_PATTERNS: Record<CustomProgressionStyle, Record<Mode, string[][]>> = {
  gospel: {
    major: [
      ["I", "iii", "vi", "ii", "IV", "iv", "I", "V"],
      ["I", "IV", "iii", "vi", "ii", "V", "I", "V"],
      ["I", "vi", "ii", "V", "iii", "vi", "iv", "I"],
    ],
    minor: [
      ["i", "iv", "♭VI", "ii", "V", "i", "♭VII", "V"],
      ["i", "♭VII", "♭VI", "iv", "ii", "V", "i", "V"],
      ["i", "III", "iv", "♭VI", "ii", "V", "i", "V"],
    ],
  },
  jazz: {
    major: [
      ["I", "vi", "ii", "V", "iii", "vi", "ii", "V"],
      ["I", "iii", "vi", "ii", "V", "IV", "iv", "I"],
      ["I", "ii", "iii", "vi", "ii", "V", "I", "V"],
    ],
    minor: [
      ["i", "ii", "V", "i", "iv", "ii", "V", "i"],
      ["i", "♭VI", "ii", "V", "i", "III", "ii", "V"],
      ["i", "iv", "♭VII", "III", "ii", "V", "i", "V"],
    ],
  },
  ccm: {
    major: [
      ["I", "V", "vi", "IV", "I", "V", "IV", "V"],
      ["vi", "IV", "I", "V", "vi", "IV", "ii", "V"],
      ["I", "iii", "IV", "V", "I", "vi", "IV", "V"],
    ],
    minor: [
      ["i", "♭VI", "III", "♭VII", "i", "♭VI", "iv", "V"],
      ["i", "♭VII", "♭VI", "♭VII", "i", "iv", "♭VI", "V"],
      ["♭VI", "III", "♭VII", "i", "♭VI", "iv", "V", "i"],
    ],
  },
  worship: {
    major: [
      ["I", "V", "vi", "IV", "I", "ii", "IV", "V"],
      ["IV", "I", "V", "vi", "IV", "I", "ii", "V"],
      ["I", "IV", "vi", "V", "I", "IV", "ii", "V"],
    ],
    minor: [
      ["i", "♭VI", "III", "♭VII", "i", "iv", "♭VI", "V"],
      ["♭VI", "♭VII", "i", "III", "♭VI", "iv", "V", "i"],
      ["i", "iv", "♭VI", "III", "♭VII", "iv", "V", "i"],
    ],
  },
};

const RICH_ROMANS: Record<Mode, Record<string, string[]>> = {
  major: {
    I: ["Imaj7", "I"], ii: ["ii7", "ii"], iii: ["iii7", "iii"], IV: ["IVmaj7", "IV"],
    V: ["V7", "V"], vi: ["vi7", "vi"], vii: ["viiø7", "vii°"], iv: ["iv"],
    "♭VI": ["♭VI"], "♭VII": ["♭VII7", "♭VII"],
  },
  minor: {
    i: ["i7", "iΔ7", "i"], ii: ["iiø7", "ii°"], III: ["IIImaj7", "III"], iv: ["iv7", "iv6", "iv"],
    V: ["V7♭9", "V7", "Vsus4", "V"], "♭VI": ["♭VI"], "♭VII": ["♭VII"],
  },
};

function choose<T>(values: T[], random: RandomSource) {
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

function weighted<T>(values: Array<[T, number]>, random: RandomSource) {
  const total = values.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = random() * total;
  for (const [value, weight] of values) {
    cursor -= weight;
    if (cursor <= 0) return value;
  }
  return values[values.length - 1][0];
}

function chordForRoman(bank: ChordBankChoice[], mode: Mode, roman: string, random: RandomSource) {
  const preferences = RICH_ROMANS[mode][roman] ?? [roman];
  const available = preferences.map(preference => bank.find(choice => choice.roman === preference)).filter(Boolean) as ChordBankChoice[];
  if (available.length === 0) throw new Error(`No ${roman} chord is available in this chord bank.`);
  // Rich voicings lead most often, while occasional triads keep the texture breathing.
  return weighted(available.map((choice, index) => [choice.chord, index === 0 ? 5 : 2] as [string, number]), random);
}

function destinationKey(homeKey: string, random: RandomSource) {
  const written = weighted([
    [spellRomanDegree(homeKey, 4), 4],
    [spellRomanDegree(homeKey, 5), 5],
    [spellRomanDegree(homeKey, 2), 1],
  ], random);
  const pitchClass = parseSpelledNote(written).pitchClass;
  return APP_KEYS.find(key => parseSpelledNote(key).pitchClass === pitchClass) ?? written;
}

function homeSequence(style: CustomProgressionStyle, key: string, mode: Mode, random: RandomSource) {
  const bank = chordBankForKey(key, mode);
  const base = choose(STYLE_PATTERNS[style][mode], random);
  const length = weighted([[6, 2], [8, 5], [10, 3], [12, 3], [16, 1]], random);
  const romans = Array.from({ length }, (_, index) => base[index % base.length]);
  // Half of the ideas land home; the others finish on a dominant turnaround.
  romans[length - 1] = random() < .52 ? (mode === "major" ? "I" : "i") : "V";
  return romans.map(roman => chordForRoman(bank, mode, roman, random));
}

function modulationSequence(style: CustomProgressionStyle, homeKey: string, mode: Mode, random: RandomSource) {
  const targetKey = destinationKey(homeKey, random);
  const homeBank = chordBankForKey(homeKey, mode);
  const targetBank = chordBankForKey(targetKey, mode);
  const homeTonic = mode === "major" ? "I" : "i";
  const pivotRoman = targetKey === spellRomanDegree(homeKey, 4) ? (mode === "major" ? "IV" : "iv") : "V";
  const intro = choose(STYLE_PATTERNS[style][mode], random).slice(0, 4);
  intro[0] = homeTonic;
  intro[3] = pivotRoman;
  const returnHome = random() < .42;
  const targetCadence = mode === "major" ? ["ii", "V", "I", "vi"] : ["ii", "V", "i", "♭VI"];
  const chords = [
    ...intro.map(roman => chordForRoman(homeBank, mode, roman, random)),
    ...targetCadence.map(roman => chordForRoman(targetBank, mode, roman, random)),
  ];
  if (returnHome) {
    const homeCadence = mode === "major" ? ["IV", "ii", "V", "I"] : ["iv", "ii", "V", "i"];
    chords.push(...homeCadence.map(roman => chordForRoman(homeBank, mode, roman, random)));
  } else {
    const ending = mode === "major" ? ["ii", "V", "I"] : ["iv", "V", "i"];
    chords.push(...ending.map(roman => chordForRoman(targetBank, mode, roman, random)));
  }
  return { chords, targetKey, returnHome };
}

function rhythmFor(length: number, style: CustomProgressionStyle, meterBeats: number, random: RandomSource) {
  const palette: Array<[number, number]> = style === "jazz"
    ? [[.25, 1], [.5, 2], [1, 5], [1.5, 2], [2, 4], [4, 1]]
    : style === "gospel"
      ? [[.25, 1], [.5, 2], [1, 5], [1.5, 2], [2, 5], [3, 1], [4, 2]]
      : [[.25, 1], [.5, 1], [1, 4], [2, 6], [3, 1], [4, 3], [8, 1]];
  return Array.from({ length }, (_, index) => {
    if (index === length - 1) return Math.max(1, Math.min(8, meterBeats));
    return weighted(palette, random);
  });
}

export function generateCustomProgression(options: {
  key: string;
  mode: Mode;
  style: CustomProgressionStyle;
  meterBeats?: number;
  random?: RandomSource;
}): GeneratedCustomProgression {
  const random = options.random ?? Math.random;
  const shouldModulate = random() < .28;
  if (shouldModulate) {
    const modulation = modulationSequence(options.style, options.key, options.mode, random);
    return {
      chords: modulation.chords,
      durations: rhythmFor(modulation.chords.length, options.style, options.meterBeats ?? 4, random),
      establishedKey: modulation.returnHome ? options.key : modulation.targetKey,
      modulated: true,
      returnedHome: modulation.returnHome,
    };
  }
  const chords = homeSequence(options.style, options.key, options.mode, random);
  return {
    chords,
    durations: rhythmFor(chords.length, options.style, options.meterBeats ?? 4, random),
    establishedKey: options.key,
    modulated: false,
    returnedHome: true,
  };
}
