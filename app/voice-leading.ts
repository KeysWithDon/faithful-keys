import { parseSpelledNote } from "./music-theory.ts";

export type VoiceLeadingStyle = "traditional" | "jazz" | "gospel" | "ccm";
export type VoicingLayout = "close" | "open" | "drop2";

export type ChordRole = {
  interval: number;
  name: string;
  required: boolean;
  priority: number;
};

export type ParsedChord = {
  symbol: string;
  root: number;
  bass: number;
  slashBass: boolean;
  quality: string;
  roles: ChordRole[];
  dominant: boolean;
  suspended: boolean;
  alterations: number[];
};

export type VoiceLeadingDiagnostics = {
  summary: string;
  commonTonesHeld: number;
  upperMovement: number[];
  bassMovement: number;
  topMovement: number;
  resolutions: string[];
  /** Distance from the lowest to highest note played by the upper hand. */
  handSpan: number;
};

export type VoicedChord = {
  symbol: string;
  parsed: ParsedChord;
  upperVoices: number[];
  bass: number;
  notes: number[];
  diagnostics: VoiceLeadingDiagnostics;
};

export type VoiceLeadingOptions = {
  style?: VoiceLeadingStyle;
  layout?: VoicingLayout;
  includeBass?: boolean;
  upperRange?: readonly [number, number];
  bassRange?: readonly [number, number];
  /** Minimum semitone clearance between the bass and the lowest upper voice. */
  minimumBassGap?: number;
  /** Maximum upper-hand reach. Values above an octave are capped at 12 semitones. */
  maximumHandSpan?: number;
  beamWidth?: number;
};

/** A practical maximum reach for a beginner or average one-handed chord shape. */
export const MAXIMUM_AVERAGE_HAND_SPAN = 12;

// The public enum is kept for compatibility, but each choice now means an
// honest, compact register position rather than an unplayable spread.
const REGISTER_PROFILES: Record<VoicingLayout, { center: number; top: number }> = {
  close: { center: 63, top: 68 },
  open: { center: 67, top: 72 },
  drop2: { center: 71, top: 76 },
};

const PC_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MOVE_COST = [0, 1, 2, 4, 7, 11, 17, 24, 32, 42, 54, 68, 84];

const mod = (value: number, divisor = 12) => ((value % divisor) + divisor) % divisor;
const unique = <T,>(items: T[]) => [...new Set(items)];
const midiName = (midi: number) => `${PC_NAMES[mod(midi)]}${Math.floor(midi / 12) - 1}`;

function pitchClass(note: string | undefined) {
  if (!note) return 0;
  try{return parseSpelledNote(note).pitchClass}catch{return 0}
}

function addRole(roles: ChordRole[], interval: number, name: string, required: boolean, priority: number) {
  const normalized = mod(interval);
  const existing = roles.find((role) => role.interval === normalized);
  if (existing) {
    existing.required ||= required;
    existing.priority = Math.max(existing.priority, priority);
    if (priority >= existing.priority) existing.name = name;
    return;
  }
  roles.push({ interval: normalized, name, required, priority });
}

/** Parse the broad chord-symbol vocabulary used by the standards library. */
export function parseChordSymbol(symbol: string): ParsedChord {
  const compact = (symbol || "C")
    .trim()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/𝄪/g, "##")
    .replace(/𝄫/g, "bb")
    .replace(/Δ/g, "maj")
    .replace(/ø/g, "m7b5")
    .replace(/°/g, "dim")
    .replace(/\s+/g, "");
  const rootMatch = compact.match(/^([A-Ga-g])((?:##|bb|#|b)?)/);
  const rootName = rootMatch ? `${rootMatch[1].toUpperCase()}${rootMatch[2]}` : "C";
  const root = pitchClass(rootName);
  const suffixWithSlash = rootMatch ? compact.slice(rootMatch[0].length) : compact;
  const slashMatch = suffixWithSlash.match(/\/([A-Ga-g])((?:##|bb|#|b)?)(?=$|[^a-z])/);
  const bass = slashMatch ? pitchClass(`${slashMatch[1].toUpperCase()}${slashMatch[2]}`) : root;
  const suffix = (slashMatch ? suffixWithSlash.slice(0, slashMatch.index) : suffixWithSlash).replace(/[()]/g, "");
  const lower = suffix.toLowerCase();
  const extensionScan = lower.replace(/add(?:2|4|6|9|11|13)/g, "");

  const halfDiminished = /m7b5|halfdim/.test(lower);
  const diminished = !halfDiminished && /dim/.test(lower);
  const minorMajor = /m\/?maj|mmaj7|minmaj|m\+7/.test(lower);
  const minor = !minorMajor && !halfDiminished && /^(m(?!aj)|min|-)/.test(lower);
  const suspended2 = /sus2/.test(lower);
  const suspended = /sus/.test(lower);
  const augmented = /aug|\+|#5/.test(lower);
  const majorSeventh = /maj7|maj9|maj11|maj13|m7\+/.test(lower) && !minorMajor;
  const stackedThirteen = /13/.test(extensionScan);
  const stackedEleven = /11/.test(extensionScan);
  const hasThirteen = stackedThirteen || /add13/.test(lower);
  const hasEleven = stackedEleven || /add11|add4/.test(lower) || stackedThirteen;
  const hasNine = /9/.test(extensionScan) || /add9|add2|6\/9|69/.test(lower) || stackedEleven || stackedThirteen;
  const hasSeven = /7/.test(extensionScan) || /9|11|13/.test(extensionScan) || /alt/.test(lower) || halfDiminished || minorMajor;
  const hasSix = !hasThirteen && /(?:^|m)6(?:\/9|9)?/.test(lower);
  const dominant = !minor && !minorMajor && !diminished && !halfDiminished && !majorSeventh && hasSeven;

  const roles: ChordRole[] = [];
  addRole(roles, 0, "root", !hasSeven && !hasNine && !hasEleven && !hasThirteen, 46);

  if (suspended2) addRole(roles, 2, "suspended 2nd", true, 100);
  else if (suspended) addRole(roles, 5, "suspended 4th", true, 100);
  else addRole(roles, minor || minorMajor || halfDiminished || diminished ? 3 : 4, minor || minorMajor || halfDiminished || diminished ? "minor 3rd" : "major 3rd", true, 110);

  let fifth = halfDiminished || diminished || /b5/.test(lower) ? 6 : augmented || /#5/.test(lower) ? 8 : 7;
  if (/no5|omit5/.test(lower)) fifth = -1;
  if (fifth >= 0) addRole(roles, fifth, fifth === 6 ? "flat 5th" : fifth === 8 ? "sharp 5th" : "5th", /b5|#5/.test(lower), /b5|#5/.test(lower) ? 96 : 24);

  if (minorMajor || majorSeventh) addRole(roles, 11, "major 7th", true, 106);
  else if (diminished && hasSeven) addRole(roles, 9, "diminished 7th", true, 106);
  else if (hasSeven) addRole(roles, 10, "minor 7th", true, 106);
  if (hasSix) addRole(roles, 9, "6th", true, 90);

  const alterations: number[] = [];
  const addAlteration = (interval: number, name: string) => {
    addRole(roles, interval, name, true, 102);
    alterations.push(mod(interval));
  };
  if (/b9/.test(lower)) addAlteration(1, "flat 9th");
  if (/#9/.test(lower)) addAlteration(3, "sharp 9th");
  if (/b11/.test(lower)) addAlteration(4, "flat 11th");
  if (/#11/.test(lower)) addAlteration(6, "sharp 11th");
  if (/b13/.test(lower)) addAlteration(8, "flat 13th");
  if (/#13/.test(lower)) addAlteration(10, "sharp 13th");
  if (/alt/.test(lower)) {
    addAlteration(1, "flat 9th");
    addAlteration(3, "sharp 9th");
    addAlteration(8, "flat 13th");
  }
  if (hasNine && !/b9|#9/.test(lower)) addRole(roles, 2, "9th", true, 94);
  if (hasEleven && !/b11|#11/.test(lower)) addRole(roles, 5, "11th", true, 93);
  if (hasThirteen && !/b13|#13/.test(lower)) addRole(roles, 9, "13th", true, 92);

  const quality = halfDiminished ? "half-diminished"
    : diminished ? "diminished"
    : suspended2 ? "sus2"
    : suspended ? "sus4"
    : minorMajor ? "minor-major"
    : minor ? "minor"
    : augmented ? "augmented"
    : majorSeventh ? "major"
    : dominant ? "dominant"
    : "major";

  return {
    symbol,
    root,
    bass,
    slashBass: Boolean(slashMatch),
    quality,
    roles: roles.sort((a, b) => b.priority - a.priority),
    dominant,
    suspended: suspended || suspended2,
    alterations: unique(alterations),
  };
}

type Candidate = {
  upper: number[];
  bass: number;
  parsed: ParsedChord;
  initial: number;
  signature: string;
  requestedLayout: VoicingLayout;
};

type VoicePair = readonly [number, number];

function roleSelections(parsed: ParsedChord) {
  const required = parsed.roles.filter((role) => role.required).sort((a, b) => b.priority - a.priority);
  const hasWrittenColorTone = parsed.roles.some((role) => /7th|6th|9th|11th|13th/.test(role.name));
  const desiredCount = Math.min(5, Math.max(hasWrittenColorTone ? 4 : 3, required.length));
  const optional = parsed.roles.filter((role) => !role.required).sort((a, b) => b.priority - a.priority);
  const base = required.slice(0, desiredCount).map((role) => mod(parsed.root + role.interval));
  const selections: number[][] = [];
  const addSelection = (preferred: number[]) => {
    const selection = [...base];
    for (const pc of preferred) {
      if (selection.length >= desiredCount) break;
      selection.push(pc);
    }
    while (selection.length < desiredCount) selection.push(selection[selection.length % Math.max(1, selection.length)] ?? parsed.root);
    selections.push(selection);
  };
  const optionalPcs = optional.map((role) => mod(parsed.root + role.interval));
  const root = parsed.root;
  const third = parsed.roles.find((role) => /3rd/.test(role.name));
  const thirdPc = third ? mod(root + third.interval) : root;
  const fifth = parsed.roles.find((role) => /5th/.test(role.name));
  const fifthPc = fifth ? mod(root + fifth.interval) : mod(root + 7);

  addSelection([...optionalPcs, root, fifthPc, thirdPc]);
  addSelection([...optionalPcs.filter((pc) => pc !== root), thirdPc, root, fifthPc]);
  addSelection([thirdPc, ...optionalPcs, fifthPc, root]);
  addSelection([root, thirdPc, ...optionalPcs, fifthPc]);
  return unique(selections.map((selection) => selection.sort((a, b) => a - b).join(","))).map((key) => key.split(",").map(Number));
}

function placementsForSelection(selection: number[], low: number, high: number) {
  const choices = selection.map((pc) => Array.from({ length: high - low + 1 }, (_, index) => low + index).filter((midi) => mod(midi) === pc));
  const placements = new Map<string, number[]>();
  const visit = (index: number, chosen: number[]) => {
    if (index === choices.length) {
      const sorted = [...chosen].sort((a, b) => a - b);
      if (unique(sorted).length !== sorted.length) return;
      placements.set(sorted.join(","), sorted);
      return;
    }
    for (const midi of choices[index]) visit(index + 1, [...chosen, midi]);
  };
  visit(0, []);
  return [...placements.values()];
}

function compactVoicing(notes: number[], low: number, high: number, maximumHandSpan: number) {
  const close = [...notes].sort((a, b) => a - b);
  const closeSpan = close[close.length - 1] - close[0];
  if (close[0] < low || close[close.length - 1] > high || closeSpan > maximumHandSpan || unique(close).length !== close.length) return null;
  return close;
}

function bassChoices(parsed: ParsedChord, upper: number[], low: number, high: number, minimumGap: number) {
  const third = parsed.roles.find((role) => /3rd/.test(role.name));
  const fifth = parsed.roles.find((role) => /5th/.test(role.name));
  const pcs = parsed.slashBass
    ? [parsed.bass]
    : unique([parsed.root, third ? mod(parsed.root + third.interval) : parsed.root, fifth ? mod(parsed.root + fifth.interval) : mod(parsed.root + 7)]);
  const choices: number[] = [];
  for (const pc of pcs) {
    for (let midi = low; midi <= high; midi += 1) {
      if (mod(midi) === pc && midi <= upper[0] - minimumGap) choices.push(midi);
    }
  }
  if (choices.length) return choices;
  let fallback = low + mod(parsed.bass - low);
  while (fallback > upper[0] - minimumGap && fallback - 12 >= low) fallback -= 12;
  return fallback <= upper[0] - minimumGap ? [fallback] : [];
}

function buildCandidates(parsed: ParsedChord, options: Required<Pick<VoiceLeadingOptions, "style" | "layout" | "upperRange" | "bassRange" | "minimumBassGap" | "maximumHandSpan">>) {
  // Keep the chord above the bass register even when a high bass inversion is
  // selected. This is a low-interval-limit guard, not merely a scoring hint.
  const low = Math.max(options.upperRange[0], options.bassRange[1] + options.minimumBassGap);
  const high = options.upperRange[1];
  const voicings = new Map<string, number[]>();
  for (const selection of roleSelections(parsed)) {
    for (const placement of placementsForSelection(selection, low, high)) {
      const span = placement[placement.length - 1] - placement[0];
      if (span > options.maximumHandSpan) continue;
      const laidOut = compactVoicing(placement, low, high, options.maximumHandSpan);
      if (!laidOut) continue;
      const laidSpan = laidOut[laidOut.length - 1] - laidOut[0];
      if (laidSpan > options.maximumHandSpan) continue;
      voicings.set(laidOut.join(","), laidOut);
    }
  }

  const candidates: Candidate[] = [];
  const registerProfile = REGISTER_PROFILES[options.layout];
  for (const upper of voicings.values()) {
    for (const bass of bassChoices(parsed, upper, options.bassRange[0], options.bassRange[1], options.minimumBassGap)) {
      const center = upper.reduce((sum, note) => sum + note, 0) / upper.length;
      const top = upper[upper.length - 1];
      const span = top - upper[0];
      const bassGap = upper[0] - bass;
      const nonRootBass = mod(bass) === parsed.root ? 0 : options.style === "ccm" ? 18 : 14;
      const doubledRoot = upper.filter((note) => mod(note) === parsed.root).length;
      const rootlessReward = (options.style === "jazz" || options.style === "gospel") && parsed.roles.some((role) => /7th/.test(role.name)) && doubledRoot === 0 ? -2 : 0;
      const preferredBassGap = options.style === "ccm" ? 12 : 15;
      const handComfort = Math.abs(span - 9) * 0.65 + Math.max(0, span - 10) * 7;
      const initial = Math.abs(center - registerProfile.center) * 2.2 + Math.abs(top - registerProfile.top) + handComfort + Math.abs(bassGap - preferredBassGap) * 0.3 + nonRootBass + Math.max(0, doubledRoot - 1) * 4 + rootlessReward;
      candidates.push({ upper, bass, parsed, initial, signature: `${bass}|${upper.join(",")}`, requestedLayout: options.layout });
    }
  }

  if (!candidates.length) {
    throw new RangeError(`No ${options.maximumHandSpan}-semitone upper-hand voicing for ${parsed.symbol} fits the requested register.`);
  }
  return candidates.sort((a, b) => a.initial - b.initial || a.signature.localeCompare(b.signature)).slice(0, 24);
}

function voicePairs(previous: number[], current: number[]): VoicePair[] {
  if (previous.length === current.length) return previous.map((note, index) => [note, current[index]] as const);
  const shorterIsPrevious = previous.length < current.length;
  const shorter = shorterIsPrevious ? previous : current;
  const longer = shorterIsPrevious ? current : previous;
  let best: VoicePair[] = [];
  let bestCost = Number.POSITIVE_INFINITY;
  for (let skipped = 0; skipped < longer.length; skipped += 1) {
    const pairedLonger = longer.filter((_, index) => index !== skipped);
    const pairs = shorter.map((note, index) => shorterIsPrevious ? [note, pairedLonger[index]] as const : [pairedLonger[index], note] as const);
    const cost = pairs.reduce((sum, [from, to]) => sum + Math.abs(to - from), 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = pairs;
    }
  }
  return best;
}

type Tendency = { from: number; to: number; label: string };

function chordThird(parsed: ParsedChord) {
  const role = parsed.roles.find((item) => /3rd/.test(item.name));
  return role ? mod(parsed.root + role.interval) : mod(parsed.root + 4);
}

function tendencyMoves(previous: ParsedChord, current: ParsedChord): Tendency[] {
  const moves: Tendency[] = [];
  const rootDelta = mod(current.root - previous.root);
  if (previous.dominant && rootDelta === 5) {
    moves.push({ from: mod(previous.root + 4), to: current.root, label: "dominant 3rd → tonic" });
    moves.push({ from: mod(previous.root + 10), to: chordThird(current), label: "dominant 7th → chord 3rd" });
    if (previous.alterations.includes(1)) moves.push({ from: mod(previous.root + 1), to: mod(current.root + 7), label: "flat 9 → chord 5th" });
    if (previous.alterations.includes(3)) moves.push({ from: mod(previous.root + 3), to: mod(current.root + 11), label: "sharp 9 → leading tone" });
    if (previous.alterations.includes(8)) moves.push({ from: mod(previous.root + 8), to: chordThird(current), label: "flat 13 → chord 3rd" });
    if (previous.alterations.includes(6)) moves.push({ from: mod(previous.root + 6), to: current.root, label: "sharp 11 → tonic" });
  } else if (previous.dominant && rootDelta === 11) {
    moves.push({ from: mod(previous.root + 4), to: chordThird(current), label: "tritone 3rd → chord 3rd" });
    moves.push({ from: mod(previous.root + 10), to: current.root, label: "tritone 7th → tonic" });
  } else if (previous.dominant && rootDelta === 2) {
    moves.push({ from: mod(previous.root + 4), to: chordThird(current), label: "backdoor 3rd → chord 3rd" });
    moves.push({ from: mod(previous.root + 10), to: mod(current.root + 7), label: "backdoor 7th → chord 5th" });
  }
  if (previous.suspended && previous.root === current.root && !current.suspended) {
    const suspension = previous.roles.find((role) => /suspended/.test(role.name));
    if (suspension) moves.push({ from: mod(previous.root + suspension.interval), to: chordThird(current), label: "suspension → chord 3rd" });
  }
  if (previous.quality === "diminished" && rootDelta === 1) {
    moves.push({ from: previous.root, to: current.root, label: "leading diminished → tonic" });
  }
  return moves;
}

function resolvedTendencies(previous: Candidate, current: Candidate, pairs = voicePairs(previous.upper, current.upper)) {
  const resolutions: string[] = [];
  let unresolved = 0;
  for (const tendency of tendencyMoves(previous.parsed, current.parsed)) {
    const sourceExists = previous.upper.some((note) => mod(note) === tendency.from);
    if (!sourceExists) continue;
    const pair = pairs.find(([from, to]) => mod(from) === tendency.from && mod(to) === tendency.to && Math.abs(to - from) <= 3);
    const resolved = Boolean(pair);
    if (resolved && pair) resolutions.push(`${midiName(pair[0])} → ${midiName(pair[1])}`);
    else unresolved += 1;
  }
  return { resolutions, unresolved };
}

function transitionCost(previous: Candidate, current: Candidate, style: VoiceLeadingStyle) {
  const pairs = voicePairs(previous.upper, current.upper);
  let cost = pairs.reduce((sum, [from, to]) => sum + (MOVE_COST[Math.min(12, Math.abs(to - from))] ?? 90), 0);
  const previousPcs = unique(previous.upper.map((note) => mod(note)));
  const currentPcs = new Set(current.upper.map((note) => mod(note)));
  const commonPcs = previousPcs.filter((pc) => currentPcs.has(pc));
  const heldPcs = unique(current.upper.filter((note) => previous.upper.includes(note)).map((note) => mod(note)));
  cost += (commonPcs.length - heldPcs.length) * (style === "ccm" ? 20 : 14);
  cost -= heldPcs.length * (style === "ccm" ? 6 : 4);

  const tendency = resolvedTendencies(previous, current, pairs);
  cost += tendency.unresolved * 62;
  cost -= tendency.resolutions.length * 12;

  const topMove = current.upper[current.upper.length - 1] - previous.upper[previous.upper.length - 1];
  cost += Math.abs(topMove) <= 2 ? -4 : Math.abs(topMove) > 4 ? (Math.abs(topMove) - 4) * (style === "ccm" ? 8 : 5) : 0;
  const bassMove = current.bass - previous.bass;
  cost += MOVE_COST[Math.min(12, Math.abs(bassMove))] * 0.65;
  // Very wide spacing is legal, but gently prefer a cohesive left-hand/right-
  // hand relationship once the lowest upper voice exceeds two octaves above.
  cost += Math.max(0, current.upper[0] - current.bass - 24) * 1.25;
  if (!current.parsed.slashBass && mod(current.bass) !== current.parsed.root) cost += style === "ccm" ? 9 : 16;
  if (!previous.parsed.slashBass && !current.parsed.slashBass && mod(previous.bass) !== previous.parsed.root && mod(current.bass) !== current.parsed.root) cost += 10;

  const directions = pairs.map(([from, to]) => Math.sign(to - from)).filter(Boolean);
  if (directions.length >= 3 && directions.every((direction) => direction === directions[0])) cost += 10;
  if (bassMove && topMove && Math.sign(bassMove) !== Math.sign(topMove)) cost -= 4;
  if (pairs.some(([from, to]) => from === to)) cost -= 2;
  if (style === "gospel") cost -= pairs.filter(([from, to]) => Math.abs(to - from) === 1).length * 2;

  const previousAll = [previous.bass, ...previous.upper];
  const currentAll = [current.bass, ...current.upper];
  const parallelCount = Math.min(previousAll.length, currentAll.length);
  for (let first = 0; first < parallelCount; first += 1) {
    for (let second = first + 1; second < parallelCount; second += 1) {
      const oldInterval = mod(previousAll[second] - previousAll[first]);
      const newInterval = mod(currentAll[second] - currentAll[first]);
      const firstDirection = Math.sign(currentAll[first] - previousAll[first]);
      const secondDirection = Math.sign(currentAll[second] - previousAll[second]);
      if ((oldInterval === 0 || oldInterval === 7) && newInterval === oldInterval && firstDirection && firstDirection === secondDirection) {
        cost += style === "traditional" ? 10 : 5;
      }
    }
  }

  if (previous.parsed.symbol === current.parsed.symbol) {
    if (previous.upper.join(",") === current.upper.join(",")) cost += 80;
    else if (heldPcs.length >= Math.min(3, commonPcs.length)) cost -= 3;
  }
  const center = current.upper.reduce((sum, note) => sum + note, 0) / current.upper.length;
  const top = current.upper[current.upper.length - 1];
  const span = top - current.upper[0];
  const registerProfile = REGISTER_PROFILES[current.requestedLayout];
  cost += Math.abs(center - registerProfile.center) * 1.5 + Math.abs(top - registerProfile.top) * 0.45 + Math.max(0, span - 10) * 5;
  return cost;
}

function melodicRecoveryCost(earlier: Candidate | undefined, previous: Candidate, current: Candidate) {
  if (!earlier || earlier.upper.length !== previous.upper.length || previous.upper.length !== current.upper.length) return 0;
  let cost = 0;
  for (let index = 0; index < current.upper.length; index += 1) {
    const firstMove = previous.upper[index] - earlier.upper[index];
    const secondMove = current.upper[index] - previous.upper[index];
    if (Math.abs(firstMove) <= 5 || secondMove === 0) continue;
    cost += Math.sign(firstMove) === Math.sign(secondMove) ? 9 : -2;
  }
  const firstBassMove = previous.bass - earlier.bass;
  const secondBassMove = current.bass - previous.bass;
  if (Math.abs(firstBassMove) > 7 && secondBassMove) cost += Math.sign(firstBassMove) === Math.sign(secondBassMove) ? 6 : -2;
  return cost;
}

function diagnosticsFor(previous: Candidate | undefined, current: Candidate): VoiceLeadingDiagnostics {
  const handSpan = current.upper[current.upper.length - 1] - current.upper[0];
  if (!previous) {
    const important = current.parsed.roles.filter((role) => role.required && role.name !== "root").slice(0, 3).map((role) => role.name);
    const position = current.requestedLayout === "close" ? "lower" : current.requestedLayout === "drop2" ? "upper" : "middle";
    return {
      summary: `Starts in a comfortable ${position} register with ${important.join(", ") || "the defining chord tones"} clearly voiced.`,
      commonTonesHeld: 0,
      upperMovement: [],
      bassMovement: 0,
      topMovement: 0,
      resolutions: [],
      handSpan,
    };
  }
  const pairs = voicePairs(previous.upper, current.upper);
  const commonTonesHeld = unique(current.upper.filter((note) => previous.upper.includes(note)).map((note) => mod(note))).length;
  const upperMovement = pairs.map(([from, to]) => to - from);
  const bassMovement = current.bass - previous.bass;
  const topMovement = current.upper[current.upper.length - 1] - previous.upper[previous.upper.length - 1];
  const { resolutions } = resolvedTendencies(previous, current, pairs);
  const parts: string[] = [];
  if (resolutions.length) parts.push(`${resolutions.join(" and ")} resolve the active tension`);
  if (commonTonesHeld) parts.push(`${commonTonesHeld} common tone${commonTonesHeld === 1 ? " stays" : "s stay"} in place`);
  if (Math.abs(topMovement) <= 2) parts.push(`the top voice moves ${topMovement === 0 ? "nowhere" : "by step"}`);
  if (bassMovement && topMovement && Math.sign(bassMovement) !== Math.sign(topMovement)) parts.push("bass and melody move in contrary motion");
  if (!parts.length) parts.push("each upper voice takes its shortest practical one-to-one path");
  return {
    summary: `${parts.join("; ")}.`,
    commonTonesHeld,
    upperMovement,
    bassMovement,
    topMovement,
    resolutions,
    handSpan,
  };
}

type BeamNode = { candidate: Candidate; score: number; parent?: BeamNode };

export function voiceLeadProgression(chords: string[], options: VoiceLeadingOptions = {}): VoicedChord[] {
  if (!chords.length) return [];
  const resolvedOptions = {
    style: options.style ?? "traditional",
    layout: options.layout ?? "close",
    includeBass: options.includeBass ?? true,
    upperRange: options.upperRange ?? [55, 81] as const,
    bassRange: options.bassRange ?? [36, 48] as const,
    minimumBassGap: Math.max(7, Math.round(options.minimumBassGap ?? 9)),
    maximumHandSpan: Math.min(MAXIMUM_AVERAGE_HAND_SPAN, Math.max(1, Math.round(options.maximumHandSpan ?? MAXIMUM_AVERAGE_HAND_SPAN))),
    beamWidth: Math.max(8, options.beamWidth ?? 20),
  };
  const cache = new Map<string, Candidate[]>();
  const parsed = chords.map(parseChordSymbol);
  const candidatesFor = (chord: ParsedChord) => {
    const key = `${chord.symbol}|${resolvedOptions.style}|${resolvedOptions.layout}|${resolvedOptions.upperRange.join("-")}|${resolvedOptions.bassRange.join("-")}|${resolvedOptions.minimumBassGap}|${resolvedOptions.maximumHandSpan}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const candidates = buildCandidates(chord, resolvedOptions);
    cache.set(key, candidates);
    return candidates;
  };

  let beam: BeamNode[] = candidatesFor(parsed[0])
    .map((candidate) => ({ candidate, score: candidate.initial }))
    .sort((a, b) => a.score - b.score || a.candidate.signature.localeCompare(b.candidate.signature))
    .slice(0, resolvedOptions.beamWidth);
  for (let index = 1; index < parsed.length; index += 1) {
    const next: BeamNode[] = [];
    for (const parent of beam) {
      for (const candidate of candidatesFor(parsed[index])) {
        next.push({ candidate, parent, score: parent.score + candidate.initial * 0.08 + transitionCost(parent.candidate, candidate, resolvedOptions.style) + melodicRecoveryCost(parent.parent?.candidate, parent.candidate, candidate) });
      }
    }
    beam = next
      .sort((a, b) => a.score - b.score || a.candidate.signature.localeCompare(b.candidate.signature))
      .slice(0, resolvedOptions.beamWidth);
  }

  const chosen: Candidate[] = [];
  let node: BeamNode | undefined = beam[0];
  while (node) {
    chosen.push(node.candidate);
    node = node.parent;
  }
  chosen.reverse();
  return chosen.map((candidate, index) => ({
    symbol: chords[index],
    parsed: candidate.parsed,
    upperVoices: candidate.upper,
    bass: candidate.bass,
    notes: resolvedOptions.includeBass ? [candidate.bass, ...candidate.upper] : candidate.upper,
    diagnostics: diagnosticsFor(chosen[index - 1], candidate),
  }));
}

export function voiceLeadingVariants(chords: string[], options: Omit<VoiceLeadingOptions, "layout"> = {}) {
  return {
    close: voiceLeadProgression(chords, { ...options, layout: "close" }),
    open: voiceLeadProgression(chords, { ...options, layout: "open" }),
    drop2: voiceLeadProgression(chords, { ...options, layout: "drop2" }),
  };
}
