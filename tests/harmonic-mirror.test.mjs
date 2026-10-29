import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {midiName,scalePcs,sharedKeys,recognizeChord,voiceLeading,chordStructure} from '../public/harmonic-mirror-engine.mjs';

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


test('Chord DNA distinguishes the triad skeleton from its extensions',()=>{
 const maj9=chordStructure(recognizeChord([60,64,67,71,74],0));
 assert.deepEqual(maj9.core.map(t=>t.degree),['1','3','5']);
 assert.deepEqual(maj9.color.map(t=>t.degree),['9','7']);
 const min7=chordStructure(recognizeChord([57,60,64,67],0));
 assert.deepEqual(min7.core.map(t=>t.degree),['1','♭3','5']);
 assert.deepEqual(min7.color.map(t=>t.degree),['♭7']);
 const sus4=chordStructure(recognizeChord([60,65,67],0));
 assert.deepEqual(sus4.core.map(t=>t.degree),['1','4','5']);
});

test('major-seventh quality remains major in key-function analysis',()=>{
 assert.doesNotMatch(recognizeChord([53,57,60,64],0).function,/altered or borrowed/);
});

test('Harmonic Mirror removes octave-light chart but retains MIDI and all geometry layers',()=>{
 const html=readFileSync(new URL('../public/harmonic-atlas.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/id="noteGrid"|lightByMidi|register-body/);
 assert.match(html,/id="dnaDegrees"/);
 assert.match(html,/id="discovery"/);
 assert.match(html,/id="gravityPath"/);
 assert.match(html,/id="motionPaths"/);
 assert.match(html,/id="nearby"/);
 assert.match(html,/faithful-keys-midi-bridge/);
 assert.match(html,/function sustain\(/);
 assert.match(html,/function demoStep\(/);
 assert.match(html,/discoveryTimer=setTimeout/);
});
