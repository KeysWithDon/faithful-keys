import assert from 'node:assert/strict';
import test from 'node:test';
import { featureAllowed, freshProfile, completeSession, emptySkill, recordAttempt, recommendations, skillState, type Attempt, type Session } from '../app/learning/model.ts';
import { SKILL_MAP } from '../app/learning/registry.ts';
import { loadLearning, saveLearning } from '../app/learning/persistence.ts';
import { matchChord, matchInterval, parseMidi, sequenceStep, voiceMovement } from '../app/midi/parser.ts';
import { questionFor } from '../app/learning/exercises.ts';

const memory=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>void data.set(k,v),removeItem:(k:string)=>void data.delete(k)};};
const attempt=(skillId:string,correct=true,at=Date.now()):Attempt=>({skillId,correct,at,responseMs:1000,hint:false,expected:'x',answer:'x',input:'screen',difficulty:1});
function strongSession(skillId:string,kind:'practice'|'test-out'='practice',at=Date.now()):Session{return {id:`s-${at}-${Math.random()}`,started:at,kind,target:skillId,attempts:Array.from({length:4},()=>attempt(skillId,true,at))};}

test('new Guided profiles expose only foundation skills and lock advanced features',()=>{const p={...freshProfile(),mode:'guided' as const};assert.equal(skillState(p,'notes'),'AVAILABLE');assert.equal(featureAllowed(p,'custom'),false);assert.equal(recommendations(p)[0].skill.id,'notes');});
test('mastery requires repeated strong sessions and unlocks prerequisites transitively',()=>{let p={...freshProfile(),mode:'guided' as const};for(let i=0;i<3;i++)p=completeSession(p,strongSession('notes','practice',Date.now()+i*86400000),Date.now()+i*86400000);assert.equal(p.skills.notes.unlocked,true);assert.equal(skillState(p,'geography'),'AVAILABLE');assert.equal(skillState(p,'major-triads'),'AVAILABLE');});
test('test-out grants provisional credit without pretending retention is complete',()=>{let p={...freshProfile(),mode:'guided' as const};p=completeSession(p,strongSession('notes','test-out'),Date.now());assert.equal(p.skills.notes.unlocked,true);assert.equal(p.skills.notes.provisional,true);});
test('weaknesses influence mistake records without making unlearned skills weak',()=>{let p={...freshProfile(),mode:'guided' as const};assert.equal(recommendations(p).some(r=>r.skill.id==='advanced-voicings'),false);p={...p,skills:{notes:{...emptySkill(),attempts:2,correct:1,unlocked:true}}};p=recordAttempt(p,{id:'s',started:0,target:'notes',kind:'practice',attempts:[]},attempt('notes',false));assert.equal(Object.keys(p.skills.notes.mistakes).length,1);});
test('learning progress survives versioned local persistence',()=>{const storage=memory();const p={...freshProfile(),mode:'guided' as const,placementDone:true};assert.equal(saveLearning(storage,p),true);const loaded=loadLearning(storage);assert.equal(loaded.profile.mode,'guided');assert.equal(loaded.profile.placementDone,true);});
test('MIDI parser handles note on/off, malformed data and panic safely',()=>{assert.deepEqual(parseMidi([0x90,60,100],10)?.pitchClass,0);assert.equal(parseMidi([0x90,60,0],20)?.type,'off');assert.equal(parseMidi([0x90,200,100]),null);assert.equal(parseMidi([0xb0,123,0])?.type,'panic');});
test('MIDI evaluators respect chord pitch classes, bass, intervals and sequences',()=>{assert.equal(matchChord([52,55,60],[60,64,67],52),true);assert.equal(matchChord([60,63,67],[60,64,67]),false);assert.equal(matchInterval([60,64],4),true);assert.equal(sequenceStep([60,62],[60,62]).complete,true);assert.equal(voiceMovement([60,64,67],[59,64,67]),1);});
test('exercise generation follows the skill and supports chord progressions',()=>{const p=freshProfile();const q=questionFor('gospel',p);assert.equal(q.chordSequence,true);assert.equal(q.expected.length,4);assert.equal(SKILL_MAP.gospel.material,'gospel');});
