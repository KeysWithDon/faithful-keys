import { CHORD_TYPES } from './chord-reader.ts';
import { CIRCLE_NOTE_NAMES, CIRCLE_PITCH_CLASSES, type CircleDirection } from './ear-training.ts';
import { spellChordPitch } from './music-theory.ts';

export type ChordPlayback = 'harmonic' | 'ascending' | 'descending' | 'ascending-harmonic';
export const HEAR_CHORD_TYPES = CHORD_TYPES.map(shape => ({
  ...shape,
  label: shape.suffix || 'Major',
  // Fold extensions into the practice octave while keeping every pitch class.
  offsets: [...new Set(shape.intervals.map(interval => interval % 12))].sort((a,b)=>a-b),
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
