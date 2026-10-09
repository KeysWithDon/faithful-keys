import test from 'node:test';
import assert from 'node:assert/strict';
import {readerKeyboardRange,readerWrittenNote} from '../app/chord-reader-notation.ts';

test('grand staff places middle C and both clefs at their correct diatonic positions',()=>{
  assert.equal(readerWrittenNote(60,'C').y,108);
  assert.equal(readerWrittenNote(64,'C').y,96);
  assert.equal(readerWrittenNote(77).y,48);
  assert.equal(readerWrittenNote(57).y,120);
  assert.equal(readerWrittenNote(43).y,168);
  assert.equal(readerWrittenNote(36).y,192);
});
test('chord spelling distinguishes diminished sevenths and altered intervals',()=>{
  assert.equal(readerWrittenNote(69,'Cdim7').name,'B𝄫');
  assert.equal(readerWrittenNote(66,'C7b5').name,'G♭');
  assert.equal(readerWrittenNote(63,'C7#9').name,'D♯');
  assert.equal(readerWrittenNote(66,'Cmaj9#11').name,'F♯');
  const cb=readerWrittenNote(59,'Cb');
  assert.equal(cb.name,'C♭');
  assert.equal(cb.octave,4);
  assert.equal(cb.y,108);
});
test('keyboard remains fixed at C2 through C6 regardless of incoming notes',()=>{
  const keys=readerKeyboardRange();
  assert.equal(keys[0],36);
  assert.equal(keys.at(-1),84);
  assert.equal(keys.length,49);
  assert.deepEqual(readerKeyboardRange([21,108]),keys);
  assert.deepEqual(readerKeyboardRange([0,127]),keys);
});
