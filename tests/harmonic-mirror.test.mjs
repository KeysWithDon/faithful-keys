import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {midiName,scalePcs,sharedKeys,recognizeChord,voiceLeading,chordStructure,pitchGeometry,intervalRays} from '../public/harmonic-mirror-engine.mjs';

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

test('pitch-class shapes reflect real unique notes, not a fixed triangle',()=>{
 assert.equal(pitchGeometry([60,64,67]).shape,'Triangle');
 assert.equal(pitchGeometry([60,64,67,71]).shape,'Quadrilateral');
 assert.equal(pitchGeometry([60,62,64,67,71]).shape,'Pentagon');
 assert.equal(pitchGeometry([60,62,64,66,68,70]).shape,'Hexagon');
 assert.equal(pitchGeometry([60,63,66,69]).regular,true);
 assert.equal(pitchGeometry([60,64,68]).regular,true);
 assert.equal(pitchGeometry([60,64,67,72]).count,3);
 assert.deepEqual(pitchGeometry([60,64,67]).pcs,pitchGeometry([64,67,72]).pcs);
 assert.equal(pitchGeometry([60,64,67]).edges.length,3);
});

test('interval rays measure pitch-class distance from the true chord root',()=>{
 const rays=intervalRays([60,64,67],0);
 assert.equal(rays.center,0);
 assert.deepEqual(rays.rays.map(x=>x.semitones),[4,7]);
 const fallback=intervalRays([55,59],null);
 assert.equal(fallback.center,7);
});

test('each diagram is a separate selectable view with its own explanation',()=>{
 const html=readFileSync(new URL('../public/harmonic-atlas.html',import.meta.url),'utf8');
 const script=readFileSync(new URL('../public/harmonic-mirror-app.mjs',import.meta.url),'utf8');
 const guide=readFileSync(new URL('../public/harmonic-mirror-guide.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/id="noteGrid"|lightByMidi|register-body/);
 for(const view of ['shape','intervals','motion','keys']){
   assert.match(html,new RegExp('data-view="'+view+'"'));
   assert.match(script,new RegExp("currentView==='"+view+"'"));
 }
 for(const s of ['pitchGeometry','intervalRays','voiceLeading','sharedKeys','render()'])assert.ok(script.includes(s));
 assert.match(html,/harmonic-mirror-guide\.html/);
 for(const label of ['C major','Cmaj7','Cmaj9','Voice movement','Key relationships','Intervals'])assert.ok(guide.includes(label));
 const forbidden=/\\b(?:shape|shapes|triangle|triangles|square|squares|pentagon|hexagon|quadrilateral|polygon|geometry|geometric|diagrams?|vertices|vertex|corners?)\\b/i;
 const visibleText=html.replace(/<[^>]*>/g,' ')+' '+guide.replace(/<[^>]*>/g,' ');
 assert.doesNotMatch(visibleText,forbidden);
 assert.match(html,/>Chords<\\/button>/);
 assert.match(script,/shape:\\{title:'Chords'/);
 assert.doesNotMatch(script,/heading\\(geom\\.shape\\)/);
 assert.doesNotMatch(script,/geometry\\.shape\\.toLowerCase\\(\\)/);
 assert.match(guide,/Back to Harmonic Mirror/);
 assert.match(script,/heading\(chordText\(analysis\)\)/);
 assert.doesNotMatch(script,/heading\(geom\.shape\)/);
 assert.doesNotMatch(script,/geometry\.shape\.toLowerCase\(\)/);
 assert.match(script,/faithful-keys-midi-bridge/);
 assert.match(script,/function sustain\(/);
 assert.match(script,/function demoStep\(/);
 assert.match(script,/if\(!Number\.isInteger\(n\)\|\|n<21\|\|n>108\)return/);
});
