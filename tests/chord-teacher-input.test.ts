import test from 'node:test';
import assert from 'node:assert/strict';
import {ChordPromptInput} from '../app/chord-teacher-input.ts';
import {MidiManager} from '../app/midi/manager.ts';
import {decodeBleMidi,encodeBleMidi} from '../app/midi/bluetooth.ts';

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

test('every positive MIDI velocity, including 1, confirms the first complete chord',()=>{
  const target=[48,60,64,67];
  for(let velocity=1;velocity<=127;velocity++){
    const input=new ChordPromptInput(),midi=new MidiManager();let confirmations=0;
    midi.onNote(event=>{if(input.observe('one',target,midi.getSnapshot().pressed,true,event).accepted)confirmations++;});
    for(const note of target)midi.receive([0x90,note,velocity],0);
    for(const note of target)midi.receive([0x90,note,0],1);
    assert.equal(confirmations,1,'velocity '+velocity);
    assert.deepEqual(midi.getSnapshot().pressed,[]);
  }
});

test('very light brief staggered touches make one chord without leaving keys pressed',()=>{
  const target=[48,60,64,67],input=new ChordPromptInput(),midi=new MidiManager();let confirmations=0;
  midi.onNote(event=>{if(input.observe('one',target,midi.getSnapshot().pressed,true,event).accepted)confirmations++;});
  target.forEach((note,index)=>{
    midi.receive([0x90,note,1],index*40);
    midi.receive([0x80,note,0],index*40+10);
  });
  assert.equal(confirmations,1);
  assert.deepEqual(midi.getSnapshot().pressed,[]);
});

test('a previous prompt or slow separate notes cannot fill in a new answer',()=>{
  const target=[48,60,64,67],input=new ChordPromptInput(),midi=new MidiManager();let prompt='one';const confirmed:string[]=[];
  midi.onNote(event=>{if(input.observe(prompt,target,midi.getSnapshot().pressed,true,event).accepted)confirmed.push(prompt);});
  target.forEach((note,index)=>{midi.receive([0x90,note,1],index*40);midi.receive([0x80,note,0],index*40+5);});
  assert.deepEqual(confirmed,['one']);
  prompt='two';
  midi.receive([0x90,67,1],150);midi.receive([0x80,67,0],155);
  target.forEach((note,index)=>{midi.receive([0x90,note,1],500+index*300);midi.receive([0x80,note,0],505+index*300);});
  assert.deepEqual(confirmed,['one']);
});

test('soft Bluetooth input accepts unequal velocities and zero-velocity messages still release notes',()=>{
  const target=[48,60,64,67],input=new ChordPromptInput(),midi=new MidiManager();let confirmations=0;
  midi.onNote(event=>{if(input.observe('one',target,midi.getSnapshot().pressed,true,event).accepted)confirmations++;});
  const ons=target.flatMap((note,index)=>[0x92,note,[1,2,3,127][index]]);
  for(const packet of encodeBleMidi(ons,0))for(const message of decodeBleMidi(packet))midi.receive(message,0);
  assert.equal(confirmations,1);
  for(const packet of encodeBleMidi(target.flatMap(note=>[0x92,note,0]),1))for(const message of decodeBleMidi(packet))midi.receive(message,1);
  assert.deepEqual(midi.getSnapshot().pressed,[]);
});

test('brief soft touches still require the bass and reject any extra held note',()=>{
  const target=[48,60,64,67],input=new ChordPromptInput(),midi=new MidiManager();let confirmations=0;
  midi.onNote(event=>{if(input.observe('one',target,midi.getSnapshot().pressed,true,event).accepted)confirmations++;});
  target.slice(1).forEach((note,index)=>{midi.receive([0x90,note,1],index*20);midi.receive([0x80,note,0],index*20+5);});
  assert.equal(confirmations,0);
  midi.receive([0x90,61,1],300);
  target.forEach((note,index)=>{midi.receive([0x90,note,1],310+index*20);midi.receive([0x80,note,0],315+index*20);});
  assert.equal(confirmations,0);
});

test('clearing input discards a partial soft chord',()=>{
  const target=[48,60,64,67],input=new ChordPromptInput(),midi=new MidiManager();let confirmations=0;
  midi.onNote(event=>{if(input.observe('one',target,midi.getSnapshot().pressed,true,event).accepted)confirmations++;});
  target.slice(0,-1).forEach((note,index)=>{midi.receive([0x90,note,1],index*20);midi.receive([0x80,note,0],index*20+5);});
  input.reset([]);
  midi.receive([0x90,67,1],100);
  assert.equal(confirmations,0);
});
