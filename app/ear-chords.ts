import { CHORD_TYPES } from './chord-reader.ts';
import { CIRCLE_NOTE_NAMES, CIRCLE_PITCH_CLASSES, type CircleDirection } from './ear-training.ts';
import { spellChordPitch } from './music-theory.ts';

export type ChordPlayback = 'harmonic' | 'ascending' | 'descending' | 'ascending-harmonic';
export const HEAR_CHORD_TYPES = CHORD_TYPES.map(shape => ({
  ...shape,
  label: shape.suffix || 'Major',
  // Extensions sound above the triad rather than clustered in the same octave.
  offsets: shape.intervals.map(i => (i === 1 && /b9/.test(shape.suffix)) || (i === 2 && /9|11|13|add9/.test(shape.suffix)) || (i === 3 && /#9/.test(shape.suffix)) || (i === 5 && /11/.test(shape.suffix)) || (i === 6 && /#11/.test(shape.suffix)) || (i === 8 && /b13/.test(shape.suffix)) || (i === 9 && /13/.test(shape.suffix)) ? i + 12 : i).sort((a,b)=>a-b),
}));

export function circleChord(index:number, typeIndex:number, direction:CircleDirection='fourths') {
  const position=((index%12)+12)%12;
  const type=HEAR_CHORD_TYPES[((typeIndex%HEAR_CHORD_TYPES.length)+HEAR_CHORD_TYPES.length)%HEAR_CHORD_TYPES.length];
  const root=48+CIRCLE_PITCH_CLASSES[direction][position];
  const name=CIRCLE_NOTE_NAMES[direction][position]+type.suffix;
  const midis=type.offsets.map(offset=>root+offset);
  return { name, midis, notes:midis.map(midi=>spellChordPitch(name,midi%12)) };
}

export function chordEvents(midis:number[], mode:ChordPlayback, tempo:number) {
  const beat=60000/tempo;
  if(mode==='harmonic')return [{at:0,notes:midis}];
  const sequence=mode==='descending'?[...midis].reverse():midis;
  const events=sequence.map((note,index)=>({at:index*beat,notes:[note]}));
  if(mode==='ascending-harmonic')events.push({at:sequence.length*beat,notes:midis});
  return events;
}

export function nextChordPosition(root:number,type:number,all:boolean) {
  const nextRoot=(root+1)%12;
  return {root:nextRoot,type:all&&nextRoot===0?(type+1)%HEAR_CHORD_TYPES.length:type};
}
