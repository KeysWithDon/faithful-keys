import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyChord} from '../app/chord-reader.ts';

test('recognizes triads, doubled notes, and inversions from the actual bass',()=>{
  assert.equal(identifyChord([60,64,67,72]).matches[0],'C');
  assert.equal(identifyChord([52,60,67]).matches[0],'C/E');
  assert.equal(identifyChord([57,60,64]).matches[0],'Am');
  assert.equal(identifyChord([60,63,66]).matches[0],'Cdim');
  assert.equal(identifyChord([60,64,68]).matches[0],'Caug');
  assert.equal(identifyChord([60,65,67]).matches[0],'Csus4');
});
test('recognizes gospel and jazz extensions and fifthless voicings',()=>{
  assert.equal(identifyChord([60,64,67,71]).matches[0],'Cmaj7');
  assert.equal(identifyChord([60,62,64,67,70]).matches[0],'C9');
  assert.equal(identifyChord([60,63,65,70]).matches[0],'Cm11');
  assert.equal(identifyChord([60,64,69,70]).matches[0],'C13');
  assert.equal(identifyChord([60,61,64,70]).matches[0],'C7b9');
  assert.equal(identifyChord([60,64,71]).matches[0],'Cmaj7');
});
test('reports alternate names for ambiguous chords',()=>{
  const matches=identifyChord([60,64,67,69]).matches;
  assert.equal(matches[0],'C6');
  assert.ok(matches.includes('Am7/C'));
});
test('does not invent chords for unknown clusters, single notes, or invalid MIDI',()=>{
  assert.deepEqual(identifyChord([60,61,62,63,64]).matches,[]);
  assert.deepEqual(identifyChord([60,72]).matches,[]);
  assert.deepEqual(identifyChord([]).matches,[]);
  assert.deepEqual(identifyChord([NaN,-1,128,60.5]).notes,[]);
});

test('recognizes combined alterations, suspended extensions and minor-major chords in every key',()=>{
  for(let shift=0;shift<12;shift++){
    for(const [suffix,offsets] of [
      ['7b9#11',[0,1,4,6,7,10]], ['7#9b13',[0,3,4,7,8,10]],
      ['13sus4',[0,2,5,7,9,10]], ['m(maj9)',[0,2,3,7,11]],
      ['maj13#11',[0,2,4,6,7,9,11]], ['m11b5',[0,2,3,5,6,10]],
    ] as [string,number[]][]){
      const root=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'][shift];
      assert.ok(identifyChord(offsets.map(i=>60+shift+i)).matches.includes(root+suffix),root+suffix);
    }
  }
});
test('rootless voicings are labeled as inferred and ranked after played-root readings',()=>{
  const result=identifyChord([64,67,70,74]);
  assert.ok(result.matches.includes('C9/E'));
  assert.ok(result.inferredRoots.includes('C9/E'));
  assert.equal(result.inferredRoots.includes(result.matches[0]),false);
  assert.deepEqual(identifyChord([64,70]).inferredRoots,[]);
});
