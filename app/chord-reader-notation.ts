import { parseChordParts, parseSpelledNote, spellChordPitch, spellInterval } from './music-theory.ts';
import { READER_NOTES } from './chord-reader.ts';

export function readerWrittenNote(midi:number,chord?:string) {
  let name=chord?spellChordPitch(chord,midi%12):READER_NOTES[midi%12];
  if(chord){
    const {root,suffix}=parseChordParts(chord);
    if(/♭5|b5/.test(suffix)&&(midi-root.pitchClass+12)%12===6)name=spellInterval(root.display,4,6);
  }
  const parsed=parseSpelledNote(name);
  const offsets={bb:-2,b:-1,'':0,'#':1,'##':2};
  const octave=Math.floor((midi-offsets[parsed.accidental])/12)-1;
  const position=octave*7+'CDEFGAB'.indexOf(parsed.letter);
  const treble=midi>=60;
  const y=treble?96-(position-30)*6:168-(position-18)*6;
  return {midi,name:parsed.display,octave,position,treble,y,accidental:parsed.display.slice(1)};
}

/** Fixed five-octave reader range: add C1–B1 below the existing C2–C6 keys. */
export function readerKeyboardRange(_notes:readonly number[]=[]) {
  return Array.from({length:61},(_,i)=>24+i);
}
