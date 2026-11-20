import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {spectrumNodes,spectrumByKey,spectrumEdges,chordKey,findChords} from '../public/chord-spectrum/spectrum-model.js';
import {movementOptions,resolutionPlan} from '../public/chord-spectrum/harmony.js';
import {makeVoicing} from '../public/chord-spectrum/voicings.js';

const root=new URL('../public/chord-spectrum/',import.meta.url);
test('all 384 permanent chords have visible next choices and a complete resolution',()=>{
  assert.equal(spectrumNodes.length,384);
  assert.equal(spectrumByKey.size,384);
  const edges=new Set(spectrumEdges.map(e=>e.key));
  for(const n of spectrumNodes){
    const options=movementOptions(n.chord),plan=resolutionPlan(n.chord);
    assert.ok(options.length>0,n.chord.label);
    for(const o of options)assert.ok(spectrumByKey.has(chordKey(o.node)),o.node.label);
    assert.ok(['major','minor'].includes(plan.goal.type),'Resolution reaches a resting chord');
    for(let i=1;i<plan.steps.length;i++)assert.ok(edges.has(`${chordKey(plan.steps[i-1])}>${chordKey(plan.steps[i])}`),'Each resolution step has a drawn path');
  }
});
test('enharmonic searches reach the same permanent root and type',()=>{
  for(const [query,key]of [['Gb7','6:7'],['F#7','6:7'],['Bbm7','10:m7'],['A#min7','10:m7'],['Bdim7','11:dim7'],['Ebm7b5','3:half']]){
    assert.equal(findChords(query)[0]?.key,key,query);
  }
});
test('gospel voicings preserve every bubble symbol and use real sampled regions',async()=>{
  const manifest=JSON.parse(await readFile(new URL('audio/manifest.json',root),'utf8'));
  for(const n of spectrumNodes){
    const chord=n.chord,v=makeVoicing(chord,[],'lush',()=>.37);
    const pcs=[...new Set(v.notes.map(note=>note%12))].sort((a,b)=>a-b);
    const expected=[...new Set(chord.intervals.map(i=>(chord.pc+i)%12))].sort((a,b)=>a-b);
    assert.deepEqual(pcs,expected,chord.label);
    assert.equal(v.notes[0]%12,chord.pc,'Named root remains in the bass');
    v.notes.forEach((note,i)=>assert.equal(manifest.samples.filter(s=>note>=s.low&&note<=s.high&&v.velocities[i]>=s.velocityLow&&v.velocities[i]<=s.velocityHigh).length,1));
  }
  for(const url of new Set(manifest.samples.map(s=>s.url)))await access(new URL(url,root));
});
