import test from 'node:test';
import assert from 'node:assert/strict';
import { HEAR_CHORD_TYPES, circleChord, chordEvents, nextChordPosition } from '../app/ear-chords.ts';
import { identifyChord } from '../app/chord-reader.ts';

test('every chord type plays all twelve fourths roots with recognizable pitches',()=>{
  for(let type=0;type<HEAR_CHORD_TYPES.length;type++)for(let root=0;root<12;root++){
    const chord=circleChord(root,type);
    assert.ok(chord.midis.every(n=>n>=48&&n<=96));
    const expected=chord.name.replaceAll('♭','b').replaceAll('♯','#');
    assert.ok(identifyChord(chord.midis).matches.includes(expected),expected);
  }
  assert.deepEqual(Array.from({length:12},(_,i)=>circleChord(i,0).midis[0]%12),[0,5,10,3,8,1,6,11,4,9,2,7]);
});
test('all types advance only after a complete circle and wrap to major',()=>{
  assert.deepEqual(nextChordPosition(10,2,true),{root:11,type:2});
  assert.deepEqual(nextChordPosition(11,2,true),{root:0,type:3});
  assert.deepEqual(nextChordPosition(11,2,false),{root:0,type:2});
  assert.deepEqual(nextChordPosition(11,HEAR_CHORD_TYPES.length-1,true),{root:0,type:0});
});
test('harmonic and arpeggio modes respect note order and tempo',()=>{
  const notes=[60,64,67];
  assert.deepEqual(chordEvents(notes,'harmonic',120),[{at:0,notes}]);
  assert.deepEqual(chordEvents(notes,'descending',120),[{at:0,notes:[67]},{at:500,notes:[64]},{at:1000,notes:[60]}]);
  assert.deepEqual(chordEvents(notes,'ascending-harmonic',60).at(-1),{at:3000,notes});
});
