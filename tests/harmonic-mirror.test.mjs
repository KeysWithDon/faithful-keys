import test from 'node:test';
import assert from 'node:assert/strict';
import {midiName,scalePcs,sharedKeys,recognizeChord,voiceLeading} from '../public/harmonic-mirror-engine.mjs';

test('every MIDI octave boundary is named correctly',()=>{
 assert.equal(midiName(21),'A0');
 assert.equal(midiName(60),'C4');
 assert.equal(midiName(108),'C8');
});

test('chords are recognized from real played MIDI notes, not just root position',()=>{
 assert.equal(recognizeChord([60,64,67,71,74],0).label,'Cmaj9');
 assert.equal(recognizeChord([64,67,72],0).label,'C/E');
 assert.equal(recognizeChord([43,53,59,62,64,69],0).label,'G13');
});

test('one shape has different functions in different centers',()=>{
 const notes=[57,60,64,67];
 assert.match(recognizeChord(notes,0).function,/^vi /);
 assert.match(recognizeChord(notes,7).function,/^ii /);
 assert.match(recognizeChord(notes,5).function,/^iii /);
});

test('chromatic dissonance does not hallucinate a supported chord',()=>{
 assert.equal(recognizeChord([60,61,62,63]).kind,'cluster');
});

test('related keys share scale membership, but not identical notes',()=>{
 assert.equal(sharedKeys(0,7,'major').length,6);
 assert.equal(sharedKeys(0,0,'major').length,7);
 assert.deepEqual(scalePcs(0,'major'),[0,2,4,5,7,9,11]);
});

test('voice movement distinguishes common tones from changing voices',()=>{
 const motion=voiceLeading([55,59,62,65],[55,59,60,64]);
 assert.deepEqual(motion.held,[55,59]);
 assert.deepEqual(motion.moved.map(m=>m.delta).sort((a,b)=>a-b),[-2,-1]);
 assert.deepEqual(motion.added,[]);
 assert.deepEqual(motion.released,[]);
});
