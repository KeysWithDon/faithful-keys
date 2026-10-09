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
test('keyboard starts with three octaves and includes notes outside the default range',()=>{
  assert.equal(readerKeyboardRange([])[0],48);
  assert.equal(readerKeyboardRange([]).at(-1),84);
  assert.ok(readerKeyboardRange([21,108]).includes(21));
  assert.ok(readerKeyboardRange([21,108]).includes(108));
  const full=readerKeyboardRange([0,127]);
  assert.equal(full[0],0);
  assert.equal(full.at(-1),127);
});
