import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_VOICES,exactMatch,exactNotes,generateResolution,movedVoices,
  pitchLabel,stationaryVoices,
} from '../app/ear-first-engine.ts';

test('exact octave labeling and matching never erase octave information',()=>{
  assert.equal(pitchLabel(60),'C4');
  assert.equal(pitchLabel(72),'C5');
  assert.equal(pitchLabel(36),'C2');
  assert.ok(exactMatch([72,60,48],[48,60,72]));
  assert.equal(exactMatch([48,60,72],[48,60,84]),false);
  assert.equal(exactMatch([48,60,72],[48,60,72,79]),false);
});
test('unmoving voices are actual MIDI keys, not matching pitch classes',()=>{
  assert.deepEqual(stationaryVoices([48,60,64,70],[48,65,69,70]),[48,70]);
  assert.deepEqual(stationaryVoices([60],[72]),[]);
  assert.deepEqual(movedVoices([48,60],[48,61]),[{from:60,to:61,semitones:1}]);
});
test('tracks full ten-key voicings in exact original octaves through every stage',()=>{
  const ten=[40,47,52,55,59,64,67,71,76,79];
  assert.equal(ten.length,MAX_VOICES);
  const result=generateResolution(ten,4,'fixed',0);
  assert.equal(result.count,4);
  assert.equal(result.chords.length,5);
  assert.deepEqual(result.chords[0],ten);
  for(const chord of result.chords){
    assert.equal(chord.length,10);
    assert.deepEqual(exactNotes(chord),chord);
    assert.ok(chord.every(n=>Number.isInteger(n)&&n>=0&&n<=127));
  }
  for(let i=1;i<result.chords.length;i++)assert.equal(exactMatch(result.chords[i-1],result.chords[i]),false);
});
test('fixed has exact selected additional chord count; varied never exceeds limit',()=>{
  const home=[43,55,59,62,67,71];
  for(const max of [1,2,3,4] as const){
    for(let variation=0;variation<15;variation++){
      const fixed=generateResolution(home,max,'fixed',variation);
      const varied=generateResolution(home,max,'varied',variation);
      assert.equal(fixed.count,max);
      assert.equal(fixed.chords.length,max+1);
      assert.ok(varied.count>=1&&varied.count<=max);
      assert.equal(varied.chords.length,varied.count+1);
    }
  }
});
test('rejects ambiguous oversized or empty home chords rather than dropping voices',()=>{
  assert.throws(()=>generateResolution([60],3,'fixed'),/2–10/);
  assert.throws(()=>generateResolution(Array.from({length:11},(_,i)=>40+i),4,'fixed'),/2–10/);
});
