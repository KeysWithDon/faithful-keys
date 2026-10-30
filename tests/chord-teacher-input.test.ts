import test from 'node:test';
import assert from 'node:assert/strict';
import {ChordPromptInput} from '../app/chord-teacher-input.ts';
import {MidiManager} from '../app/midi/manager.ts';

test('the first correct play confirms a prompt once despite duplicate render notifications',()=>{
  const input=new ChordPromptInput(),target=[48,60,64,67];
  assert.equal(input.observe('one',target,target).accepted,true);
  assert.equal(input.observe('one',target,target).accepted,false);
  input.observe('one',target,[]);
  assert.equal(input.observe('one',target,target).accepted,false);
});

test('a chord reached only by releasing voices confirms without another note-on',()=>{
  const input=new ChordPromptInput();
  assert.equal(input.observe('one',[48,60,64,67],[48,60,64,67]).accepted,true);
  assert.equal(input.observe('two',[48,60,64],[48,60,64]).accepted,true);
});

test('common voices can stay down while one changed voice completes the next prompt',()=>{
  const input=new ChordPromptInput();
  input.observe('one',[48,60,64,67],[48,60,64,67]);
  input.observe('two',[48,60,65,67],[48,60,67]);
  assert.equal(input.observe('two',[48,60,65,67],[48,60,65,67]).accepted,true);
});

test('an unchanged held chord cannot answer a second identical prompt',()=>{
  const input=new ChordPromptInput(),target=[48,60,64,67];
  assert.equal(input.observe('one',target,target).accepted,true);
  assert.equal(input.observe('two',target,target).accepted,false);
  input.observe('two',target,[48,60,64]);
  assert.equal(input.observe('two',target,target).accepted,true);
});

test('an answer played once before playback ends counts when answers become eligible',()=>{
  const input=new ChordPromptInput(),target=[48,60,64,67];
  assert.equal(input.observe('one',target,target,false).accepted,false);
  assert.equal(input.observe('one',target,target,true).accepted,true);
});

test('brief MIDI taps confirm before key release and require the bass',()=>{
  const input=new ChordPromptInput(),midi=new MidiManager(),target=[48,60,64,67];
  let confirmations=0;
  midi.onNote(()=>{if(input.observe('one',target,midi.getSnapshot().pressed).accepted)confirmations++;});
  for(const note of target.slice(1))midi.receive([0x90,note,100],0);
  assert.equal(confirmations,0);
  midi.receive([0x90,48,100],1);
  for(const note of target)midi.receive([0x80,note,0],2);
  assert.equal(confirmations,1);
  assert.deepEqual(midi.getSnapshot().pressed,[]);
});
