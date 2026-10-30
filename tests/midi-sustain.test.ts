import test from 'node:test';
import assert from 'node:assert/strict';
import {MidiManager} from '../app/midi/manager.ts';
import {parseMidiControl, type NoteEvent} from '../app/midi/parser.ts';
import {PerformanceRecorder} from '../app/performance-recording.ts';

test('sustain holds sounding notes and releases only lifted keys at pedal-up',()=>{
  const midi=new MidiManager(),events:NoteEvent[]=[];midi.onNote(event=>events.push(event));
  midi.receive([0x90,60,100],0);midi.receive([0xb0,64,127],10);
  midi.receive([0x80,60,0],20);midi.receive([0x90,64,90],30);
  assert.deepEqual(midi.getSnapshot().active,[60,64]);
  assert.deepEqual(midi.getSnapshot().pressed,[64]);
  assert.deepEqual(midi.getSnapshot().sustained,[60]);
  assert.equal(events.filter(e=>e.type==='off').length,0);
  midi.receive([0xb0,64,63],100);
  assert.deepEqual(midi.getSnapshot().active,[64]);
  assert.equal(midi.getSnapshot().sustain,false);
  assert.deepEqual(events.filter(e=>e.type==='off').map(e=>[e.note,e.at,e.duration]),[[60,100,100]]);
  midi.receive([0x90,64,0],120);assert.deepEqual(midi.getSnapshot().active,[]);
});

test('pedals and reset controllers respect separate MIDI channels and rearticulation',()=>{
  const midi=new MidiManager();
  midi.receive([0xb0,64,64],0);midi.receive([0xb1,64,127],0);
  for(const status of [0x90,0x91])midi.receive([status,60,100],1);
  midi.receive([0x80,60,0],2);midi.receive([0x81,60,0],3);
  midi.receive([0x90,60,80],4); // Re-strike the sustained key.
  midi.receive([0xb0,121,0],5); // Reset pedal; physically held key stays.
  assert.deepEqual(midi.getSnapshot().active,[60]);assert.deepEqual(midi.getSnapshot().pressed,[60]);
  assert.equal(midi.getSnapshot().sustain,true);
  midi.receive([0xb0,120,0],6); // Immediate silence on channel 0 only.
  assert.deepEqual(midi.getSnapshot().active,[60]);assert.deepEqual(midi.getSnapshot().pressed,[]);
  midi.receive([0xb1,64,0],7);assert.deepEqual(midi.getSnapshot().active,[]);
});

test('all-notes-off respects sustain and disconnect clears all pedal state',()=>{
  const midi=new MidiManager();
  midi.receive([0x90,60,100],0);midi.receive([0xb0,64,127],1);midi.receive([0xb0,123,0],2);
  assert.deepEqual(midi.getSnapshot().sustained,[60]);assert.deepEqual(midi.getSnapshot().pressed,[]);
  midi.disable();assert.deepEqual(midi.getSnapshot().active,[]);assert.equal(midi.getSnapshot().sustain,false);
  midi.receive([0x90,67,100],3);midi.receive([0x80,67,0],4);assert.deepEqual(midi.getSnapshot().active,[]);
  assert.equal(parseMidiControl([0xb0,64,200]),null);assert.equal(parseMidiControl([0xb0,64]),null);
});

test('released physical keys stay released while the pedal holds sounding notes',()=>{
  const midi=new MidiManager();
  for(const note of [67,48,60,64])midi.receive([0x90,note,100],0);
  midi.receive([0xb0,64,64],1);
  for(const note of [48,60,64,67])midi.receive([0x80,note,0],2);
  assert.deepEqual(midi.getSnapshot().pressed,[]);
  assert.deepEqual([...midi.getSnapshot().sustained].sort((a,b)=>a-b),[48,60,64,67]);
  midi.receive([0x90,72,100],3);
  midi.receive([0xb0,64,127],4);
  assert.deepEqual(midi.getSnapshot().pressed,[72]);
  midi.receive([0xb0,64,0],5);
  assert.deepEqual(midi.getSnapshot().active,[72]);
  assert.deepEqual(midi.getSnapshot().sustained,[]);
  midi.receive([0x90,76,100],6);
  assert.deepEqual(midi.getSnapshot().pressed,[72,76]);
});

test('ten-note chords clear on physical release and zero-velocity note-offs without losing rearticulation',()=>{
  const midi=new MidiManager();
  const ten=[40,47,52,55,59,64,67,71,76,79];
  for(const note of ten)midi.receive([0x90,note,100],0);
  midi.receive([0xb0,64,127],1);
  assert.deepEqual(midi.getSnapshot().pressed,ten);
  for(const note of ten)midi.receive([0x80,note,0],2);
  assert.deepEqual(midi.getSnapshot().pressed,[]);
  assert.deepEqual(midi.getSnapshot().sustained,ten);
  midi.receive([0xb0,64,0],3);
  assert.deepEqual(midi.getSnapshot().active,[]);
  midi.receive([0x90,60,100],5);midi.receive([0x90,64,100],5);
  midi.receive([0x90,60,0],6);midi.receive([0x90,64,0],6);
  assert.deepEqual(midi.getSnapshot().pressed,[]);
  assert.deepEqual(midi.getSnapshot().active,[]);
});

test('a sustained performance exports sounding note durations through pedal release',()=>{
  const midi=new MidiManager(),capture=new PerformanceRecorder();capture.begin(0);
  midi.onNote(event=>capture.receive(event.type,event.note,event.velocity,event.channel,event.at));
  midi.receive([0x90,60,100],10);midi.receive([0xb0,64,127],20);midi.receive([0x80,60,0],50);
  midi.receive([0xb0,64,0],500);
  assert.deepEqual(capture.finish(600).events.map(e=>[e.type,e.ms]),[['on',10],['off',500]]);
});

test('Bluetooth chords deliver audio immediately and coalesce visual notifications',t=>{
  const originalFrame=Object.getOwnPropertyDescriptor(globalThis,'requestAnimationFrame');
  const originalCancel=Object.getOwnPropertyDescriptor(globalThis,'cancelAnimationFrame');
  const frames=new Map<number,FrameRequestCallback>();let id=0;
  Object.defineProperty(globalThis,'requestAnimationFrame',{configurable:true,value:(callback:FrameRequestCallback)=>{frames.set(++id,callback);return id;}});
  Object.defineProperty(globalThis,'cancelAnimationFrame',{configurable:true,value:(key:number)=>frames.delete(key)});
  t.after(()=>{
    if(originalFrame)Object.defineProperty(globalThis,'requestAnimationFrame',originalFrame);else Reflect.deleteProperty(globalThis,'requestAnimationFrame');
    if(originalCancel)Object.defineProperty(globalThis,'cancelAnimationFrame',originalCancel);else Reflect.deleteProperty(globalThis,'cancelAnimationFrame');
  });
  const midi=new MidiManager(),audio:number[]=[];let renders=0;
  midi.subscribe(()=>renders++);
  midi.onNote(event=>{audio.push(event.note);assert.ok(midi.getSnapshot().active.includes(event.note));});
  for(const note of [60,64,67,71,74])midi.receive([0x90,note,100],0);
  assert.deepEqual(audio,[60,64,67,71,74]);assert.equal(renders,0);assert.equal(frames.size,1);
  [...frames.values()][0](16);frames.clear();assert.equal(renders,1);
  assert.deepEqual(midi.getSnapshot().active,[60,64,67,71,74]);
});

test('a quick pedal press and release survives a coalesced Bluetooth render',t=>{
  const originalFrame=Object.getOwnPropertyDescriptor(globalThis,'requestAnimationFrame');
  const originalCancel=Object.getOwnPropertyDescriptor(globalThis,'cancelAnimationFrame');
  const frames:FrameRequestCallback[]=[];
  Object.defineProperty(globalThis,'requestAnimationFrame',{configurable:true,value:(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;}});
  Object.defineProperty(globalThis,'cancelAnimationFrame',{configurable:true,value:()=>{}});
  t.after(()=>{
    if(originalFrame)Object.defineProperty(globalThis,'requestAnimationFrame',originalFrame);else Reflect.deleteProperty(globalThis,'requestAnimationFrame');
    if(originalCancel)Object.defineProperty(globalThis,'cancelAnimationFrame',originalCancel);else Reflect.deleteProperty(globalThis,'cancelAnimationFrame');
  });
  const midi=new MidiManager();let renders=0;
  midi.subscribe(()=>renders++);
  for(const note of [60,64,67])midi.receive([0x90,note,100],0);
  midi.receive([0xb0,64,127],1);
  for(const note of [60,64,67])midi.receive([0x80,note,0],2);
  midi.receive([0xb0,64,0],3);
  assert.equal(renders,0);
  assert.deepEqual(midi.getSnapshot().pressed,[]);
  assert.equal(midi.getSnapshot().sustain,false);
  assert.deepEqual(midi.getSnapshot().active,[]);
  assert.deepEqual(midi.getSnapshot().sustained,[]);
  frames[0](16);assert.equal(renders,1);
});
