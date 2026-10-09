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
