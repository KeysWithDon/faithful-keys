import {KEYS} from '../public/chord-spectrum/theory.js';
import {lookupChord} from '../public/chord-spectrum/harmony.js';
import {coreChords,chordFunction,contextualPlan,spellInKey} from '../public/chord-spectrum/key-map.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {spectrumNodes,spectrumByKey,spectrumEdges,chordKey,findChords} from '../public/chord-spectrum/spectrum-model.js';
import {movementOptions,resolutionPlan} from '../public/chord-spectrum/harmony.js';
import {makeVoicing,VOICING_STYLES,voicingCandidates} from '../public/chord-spectrum/voicings.js';

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

test('each key transposes the same functions and lands its ii–V–I on the correct tonic',()=>{
  for(const key of KEYS){
    const [,tonic]=key;
    const core=coreChords(tonic);
    assert.equal(new Set(core.map(chord=>chord.key)).size,24);
    for(const [offset,quality,role,column] of [[2,'m9','ii⁹',0],[7,'13','V13',1],[0,'maj9','Imaj9',2],[4,'7','V7/vi',3]]){
      const chord=lookupChord(tonic+offset,quality);
      const result=chordFunction(chord,tonic,core);
      assert.equal(result.role,role);
      assert.equal(result.column,column);
    }
    assert.deepEqual(contextualPlan(lookupChord(tonic+2,'m9'),tonic).steps.map(chordKey),[
      `${(tonic+2)%12}:m9`,`${(tonic+7)%12}:13`,`${tonic}:maj9`
    ]);
    assert.equal(contextualPlan(lookupChord(tonic+4,'7'),tonic).goal.qualityId,'m9');
    assert.equal(contextualPlan(lookupChord(tonic+2,'7'),tonic).steps[1].qualityId,'13');
    assert.equal(contextualPlan(lookupChord(tonic+1,'7'),tonic).goal.pc,tonic);
  }
  const flatKey=KEYS.find(([name])=>name==='E♭');
  assert.equal(spellInKey(lookupChord(5,'half'),flatKey).label,'Fm7♭5');
  assert.equal(spellInKey(lookupChord(8,'m'),flatKey).label,'A♭m');
  assert.equal(spellInKey(lookupChord(11,'maj7'),flatKey).label,'C♭maj7');
});

test('every Chord Teacher shape fits within an octave per hand',()=>{
  const styles=Object.keys(VOICING_STYLES);
  for(const {chord} of spectrumNodes){
    for(const [mode,options] of [['pure',['auto']],['lush',styles]]){
      for(const style of options){
        const candidates=voicingCandidates(chord,null,mode,{style});
        const chosen=makeVoicing(chord,[],mode,()=>.37,{style});
        const pitchClass=note=>note%12;
        const expected=[...new Set(chord.intervals.map(interval=>pitchClass(chord.pc+interval)))].sort((a,b)=>a-b);
        for(const voice of [...candidates,chosen]){
          assert.deepEqual([...voice.leftHand,...voice.rightHand],voice.notes,chord.label);
          assert.deepEqual([...new Set(voice.notes.map(pitchClass))].sort((a,b)=>a-b),expected,chord.label);
          for(const hand of [voice.leftHand,voice.rightHand]){
            assert.ok(hand.length>=1&&hand.length<=5,chord.label);
            assert.ok(hand.at(-1)-hand[0]<=12,`${chord.label} / ${mode} / ${style}: ${hand}`);
          }
        }
      }
    }
  }
});

test('borrowed ii–V–I routes confirm a new home on the major arrival',async()=>{
  const {modulationTarget}=await import('../public/chord-spectrum/key-map.js');
  for(const [,tonic] of KEYS){
    const borrowed=lookupChord(tonic+7,'m9');
    const plan=contextualPlan(borrowed,tonic);
    const [ii,v,one]=plan.steps;
    assert.deepEqual([ii.pc,v.pc,one.pc],[borrowed.pc,tonic,(tonic+5)%12]);
    assert.equal(modulationTarget(ii,v,tonic),null);
    assert.equal(modulationTarget(v,one,tonic),one.pc);
    assert.equal(modulationTarget(lookupChord(tonic+7,'7'),lookupChord(tonic,'M'),tonic),null);
    assert.equal(modulationTarget(lookupChord(tonic+4,'7'),lookupChord(tonic+9,'m'),tonic),null);
    assert.equal(modulationTarget(lookupChord(tonic+5,'m'),lookupChord(tonic,'M'),tonic),null);
  }
});
