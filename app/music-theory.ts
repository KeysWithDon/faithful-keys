export type NoteLetter = "A"|"B"|"C"|"D"|"E"|"F"|"G";
export type SpelledNote = { letter: NoteLetter; accidental: "bb"|"b"|""|"#"|"##"; pitchClass: number; display: string };

const LETTERS: NoteLetter[] = ["C","D","E","F","G","A","B"];
const NATURAL_PC: Record<NoteLetter,number> = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const ACCIDENTAL_VALUE: Record<string,number> = {bb:-2,b:-1,"":0,"#":1,"##":2};
const mod12=(value:number)=>((value%12)+12)%12;
const glyph=(accidental:string)=>accidental.replace(/bb/g,"𝄫").replace(/##/g,"𝄪").replace(/b/g,"♭").replace(/#/g,"♯");

export function parseSpelledNote(value:string):SpelledNote {
  const match=value.trim().replace(/𝄪/g,"##").replace(/𝄫/g,"bb").replace(/♯/g,"#").replace(/♭/g,"b").match(/^([A-Ga-g])((?:bb|##|b|#)?)/);
  if(!match) throw new RangeError(`Invalid written note: ${value}`);
  const letter=match[1].toUpperCase() as NoteLetter;
  const accidental=(match[2]||"") as SpelledNote["accidental"];
  return {letter,accidental,pitchClass:mod12(NATURAL_PC[letter]+ACCIDENTAL_VALUE[accidental]),display:`${letter}${glyph(accidental)}`};
}

export function parseChordRoot(symbol:string){
  const normalized=symbol.trim().replace(/𝄪/g,"##").replace(/𝄫/g,"bb").replace(/♯/g,"#").replace(/♭/g,"b");
  const match=normalized.match(/^([A-Ga-g])((?:bb|##|b|#)?)/);
  if(!match) throw new RangeError(`Invalid chord root: ${symbol}`);
  const root=parseSpelledNote(match[0]);
  return {root,suffix:normalized.slice(match[0].length).replace(/#/g,"♯").replace(/b/g,"♭")};
}

export type ParsedChordParts = {
  root: SpelledNote;
  suffix: string;
  slashBass: SpelledNote | null;
};

/**
 * Split a chord into its written root, quality, and optional terminal bass.
 * Only a final `/NOTE` is an inversion: `C6/9` and `Fm/maj7` remain qualities.
 */
export function parseChordParts(symbol:string):ParsedChordParts {
  const value=symbol.trim();
  const slash=value.match(/\/([A-Ga-g](?:bb|##|b|#|𝄫|𝄪|♭|♯)?)$/);
  const main=slash?value.slice(0,slash.index):value;
  const parsed=parseChordRoot(main);
  return {root:parsed.root,suffix:parsed.suffix,slashBass:slash?parseSpelledNote(slash[1]):null};
}

export const pitchClassOf=(value:string)=>parseSpelledNote(value).pitchClass;

function accidentalFor(letter:NoteLetter,pitchClass:number):SpelledNote["accidental"]{
  const difference=((pitchClass-NATURAL_PC[letter]+18)%12)-6;
  if(difference===-2)return "bb"; if(difference===-1)return "b"; if(difference===0)return ""; if(difference===1)return "#"; if(difference===2)return "##";
  throw new RangeError(`Cannot spell pitch ${pitchClass} as ${letter}`);
}

export function spellInterval(rootValue:string, diatonicSteps:number, semitones:number):string {
  const root=parseSpelledNote(rootValue);
  const rootIndex=LETTERS.indexOf(root.letter);
  const letter=LETTERS[(rootIndex+diatonicSteps)%7];
  const accidental=accidentalFor(letter,mod12(root.pitchClass+semitones));
  return `${letter}${glyph(accidental)}`;
}

export function buildMajorScale(key:string):string[]{
  const intervals=[0,2,4,5,7,9,11];
  return intervals.map((semitones,index)=>spellInterval(key,index,semitones));
}

const SHARP_CHROMATIC=["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const FLAT_CHROMATIC=["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"];
const C_CHROMATIC=["C","D♭","D","E♭","E","F","F♯","G","A♭","A","B♭","B"];
const FLAT_KEYS=new Set(["F","B♭","E♭","A♭","D♭","G♭","C♭"]);
const SHARP_KEYS=new Set(["G","D","A","E","B","F♯","C♯"]);

/** Choose a musician-facing written note for a pitch class in the selected key. */
export function spellPitchClassInKey(pitchClass:number,key:string):string{
  const normalizedKey=parseSpelledNote(key).display;
  const diatonic=buildMajorScale(normalizedKey).find(note=>parseSpelledNote(note).pitchClass===mod12(pitchClass));
  if(diatonic)return diatonic;
  if(FLAT_KEYS.has(normalizedKey)||parseSpelledNote(normalizedKey).accidental==="b")return FLAT_CHROMATIC[mod12(pitchClass)];
  if(SHARP_KEYS.has(normalizedKey)||parseSpelledNote(normalizedKey).accidental==="#")return SHARP_CHROMATIC[mod12(pitchClass)];
  return C_CHROMATIC[mod12(pitchClass)];
}

/** Respell roots and slash basses for publication without changing harmony. */
export function spellChordInKey(symbol:string,key:string):string{
  const value=symbol.trim();
  if(!value||value==="?")return value;
  const parsed=parseChordParts(value);
  const root=spellPitchClassInKey(parsed.root.pitchClass,key);
  const bass=parsed.slashBass?`/${spellPitchClassInKey(parsed.slashBass.pitchClass,key)}`:"";
  return `${root}${parsed.suffix}${bass}`;
}

export function buildDiatonicSevenths(key:string):string[]{
  const scale=buildMajorScale(key);
  return [`${scale[0]}maj7`,`${scale[1]}m7`,`${scale[2]}m7`,`${scale[3]}maj7`,`${scale[4]}7`,`${scale[5]}m7`,`${scale[6]}m7♭5`];
}

/** Spell an altered scale degree by its written Roman function, not a chromatic lookup table. */
export function spellRomanDegree(target:string, degree:1|2|3|4|5|6|7, alteration=-0):string{
  const majorSemitones=[0,2,4,5,7,9,11];
  return spellInterval(target,degree-1,majorSemitones[degree-1]+alteration);
}

export function chordWithRoot(symbol:string,newSuffix?:string){const {root,suffix,slashBass}=parseChordParts(symbol);return `${root.display}${newSuffix??suffix}${slashBass?`/${slashBass.display}`:""}`}

export function spellChordPitch(symbol:string,pitchClass:number):string{
  const {root,suffix}=parseChordParts(symbol);
  const minor=/^m(?!aj)/.test(suffix); const diminished=/dim|°/.test(suffix); const augmented=/aug|♯5|#5/.test(suffix);
  const major7=/maj|Δ/.test(suffix); const degrees=[
    {step:0,semi:0},{step:2,semi:minor||diminished?3:4},{step:4,semi:diminished?6:augmented?8:7},
    {step:6,semi:diminished?9:major7?11:10},{step:1,semi:/♭9|b9/.test(suffix)?1:/♯9|#9/.test(suffix)?3:2},
    {step:3,semi:/♯11|#11/.test(suffix)?6:5},{step:5,semi:/♭13|b13/.test(suffix)?8:9},
  ];
  const found=degrees.find(item=>mod12(root.pitchClass+item.semi)===mod12(pitchClass));
  return found?spellInterval(root.display,found.step,found.semi):["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"][mod12(pitchClass)];
}

export function normalizeChordTypography(symbol:string):string{
  return symbol.replace(/([A-G])bb/g,"$1𝄫").replace(/([A-G])##/g,"$1𝄪").replace(/([A-G])b/g,"$1♭").replace(/([A-G])#/g,"$1♯");
}
