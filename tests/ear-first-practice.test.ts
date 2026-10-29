import test from 'node:test';
import assert from 'node:assert/strict';
import {checkListeningAnswer,createListeningSession,listeningOrigin,listeningTarget,nextListeningStep,type ListeningSession} from '../app/ear-first-practice.ts';

test('the teacher supplies a complete movement without waiting for a home chord',()=>{
  const lesson=createListeningSession(4,3,'fixed');
  assert.equal(lesson.phase,'chunk');assert.equal(lesson.step,1);assert.equal(lesson.chords.length,4);
  assert.deepEqual(listeningOrigin(lesson),lesson.chords[0]);
  assert.deepEqual(listeningTarget(lesson),lesson.chords[1]);
  assert.notDeepEqual(listeningOrigin(lesson),listeningTarget(lesson));
});

test('lessons respect the chosen voice count from two through ten without requiring ten',()=>{
  for(let voices=2;voices<=10;voices++)for(let turn=0;turn<12;turn++){
    const lesson=createListeningSession(voices,4,'varied',turn);
    for(const notes of lesson.chords){assert.equal(notes.length,voices);assert.equal(new Set(notes).size,voices);assert.ok(notes.every(n=>n>=21&&n<=108));}
  }
  assert.throws(()=>createListeningSession(11,3,'fixed'));
});

test('answers cannot count before listening and must match every exact pitch and octave',()=>{
  const target=[48,55,64,71];
  assert.equal(checkListeningAnswer(false,target,target),'listen');
  assert.equal(checkListeningAnswer(true,[],target),'empty');
  assert.equal(checkListeningAnswer(true,[48,55,64,83],target),'incorrect');
  assert.equal(checkListeningAnswer(true,[48,55,64],target),'incorrect');
  assert.equal(checkListeningAnswer(true,[48,55,64,71,74],target),'incorrect');
  assert.equal(checkListeningAnswer(true,[71,48,64,55],target),'correct');
});

test('each movement gets three returns and advances only after a correct response',()=>{
  let lesson=createListeningSession(4,2,'fixed');
  const original=lesson;
  if(checkListeningAnswer(true,[1,2,3],listeningTarget(lesson))==='correct')lesson=nextListeningStep(lesson);
  assert.equal(lesson,original);
  for(let movement=0;movement<2;movement++)for(let attempt=0;attempt<6;attempt++){
    assert.equal(lesson.chunk,movement);
    assert.deepEqual(listeningTarget(lesson),lesson.chords[movement+(attempt%2===0?1:0)]);
    lesson=nextListeningStep(lesson);
  }
  assert.equal(lesson.phase,'ready');
});

test('full practice follows the original order on all three passes and then completes',()=>{
  const initial=createListeningSession(4,4,'fixed');
  let lesson:ListeningSession={...initial,phase:'full',step:0};
  for(let pass=0;pass<3;pass++)for(let chord=0;chord<initial.chords.length;chord++){
    assert.deepEqual(listeningTarget(lesson),initial.chords[chord]);
    assert.deepEqual(listeningOrigin(lesson),chord?initial.chords[chord-1]:[]);
    lesson=nextListeningStep(lesson);
  }
  assert.equal(lesson.phase,'complete');assert.deepEqual(listeningTarget(lesson),[]);
});
