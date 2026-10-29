import test from 'node:test';
import assert from 'node:assert/strict';
import {MidiChordOutput,type ChordOutputPort} from '../app/midi/output.ts';
import {MidiManager} from '../app/midi/manager.ts';

function port(id='piano'){
  const sent:{data:number[];at?:number}[]=[];let cleared=0;
  const output={id,name:'Test piano Port 1',state:'connected',send(data:number[],at?:number){sent.push({data:[...data],at});},clear(){cleared++;}};
  return {output,sent,get cleared(){return cleared;}};
}
const accessFor=(output:ReturnType<typeof port>['output'])=>({inputs:new Map(),outputs:new Map([[output.id,output]]),onstatechange:null}) as unknown as MIDIAccess;

test('plays ten exact MIDI pitches on the chosen channel with scheduled note-offs and no patch changes',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const piano=port(),states:boolean[]=[];
  const output=new MidiChordOutput(playing=>states.push(playing));
  const notes=[36,43,47,50,52,55,59,62,67,71];
  const before=performance.now();
  const done=output.play(piano.output as ChordOutputPort,notes,4,700,.5);
  assert.deepEqual(piano.sent[0].data,notes.flatMap(n=>[0x93,n,64]));
  assert.deepEqual(piano.sent[1].data,notes.flatMap(n=>[0x83,n,0]));
  assert.ok(piano.sent[1].at!>=before+700);
  assert.equal(piano.sent.length,2); // No program changes or MIDI thru.
  t.mock.timers.tick(800);assert.equal(await done,true);
  assert.deepEqual(states,[true,false]);
});

test('stopping or replacing a chord cancels queued events and releases the old notes',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const first=port('first'),second=port('second'),player=new MidiChordOutput();
  const old=player.play(first.output as ChordOutputPort,[48,60,64],2,900);
  const next=player.play(second.output as ChordOutputPort,[50,62,65],7,500);
  assert.equal(await old,false);assert.equal(first.cleared,1);
  assert.deepEqual(first.sent.at(-1)?.data,[0x81,48,0,0x81,60,0,0x81,64,0]);
  player.stop();assert.equal(await next,false);assert.equal(second.cleared,1);
  assert.deepEqual(second.sent.at(-1)?.data,[0x86,50,0,0x86,62,0,0x86,65,0]);
});

test('invalid notes, channels and disconnected outputs never send note-ons',()=>{
  const piano=port(),player=new MidiChordOutput();
  for(const notes of [[],[-1,60],[60,128],[60,64.5]])assert.throws(()=>player.play(piano.output as ChordOutputPort,notes));
  for(const channel of [0,17,1.5])assert.throws(()=>player.play(piano.output as ChordOutputPort,[60],channel));
  piano.output.state='disconnected';assert.throws(()=>player.play(piano.output as ChordOutputPort,[60]));
  assert.equal(piano.sent.length,0);
});

test('output discovery is opt-in and changing receive channel stops the active chord',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const piano=port(),midi=new MidiManager();
  await midi.connect(async()=>accessFor(piano.output));
  assert.deepEqual(midi.getSnapshot().outputs,[{id:'piano',name:'Test piano Port 1'}]);
  assert.equal(midi.getSnapshot().selectedOutput,'');assert.equal(piano.sent.length,0);
  midi.selectOutput('piano');midi.setOutputChannel(5);
  const done=midi.playOutputChord([60,64,67]);
  assert.equal(midi.getSnapshot().outputPlaying,true);
  midi.setOutputChannel(6);
  assert.equal(await done,false);assert.equal(midi.getSnapshot().outputPlaying,false);
  assert.deepEqual(piano.sent.at(-1)?.data,[0x84,60,0,0x84,64,0,0x84,67,0]);
});

test('disconnecting output cancels playback and requires explicit reconnection or browser audio',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const piano=port(),midi=new MidiManager(),access=accessFor(piano.output);
  await midi.connect(async()=>access);midi.selectOutput('piano');
  const done=midi.playOutputChord([60,64,67]);
  piano.output.state='disconnected';access.onstatechange?.({} as MIDIConnectionEvent);
  assert.equal(await done,false);assert.deepEqual(midi.getSnapshot().outputs,[]);
  assert.match(midi.getSnapshot().outputMessage,/disconnected/i);
  assert.throws(()=>midi.playOutputChord([60,64,67]),/Choose/);
  midi.disable();assert.equal(midi.getSnapshot().selectedOutput,'');
});

test('input notes are never automatically echoed back to the selected MIDI output',async()=>{
  const piano=port(),midi=new MidiManager();await midi.connect(async()=>accessFor(piano.output));midi.selectOutput('piano');
  midi.receive([0x90,60,100],0);midi.receive([0x80,60,0],10);
  assert.equal(piano.sent.length,0);
});

test('outputs without queue clearing use cancellable note-off timers',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const piano=port(),player=new MidiChordOutput();
  const legacy={id:piano.output.id,state:'connected',send:piano.output.send} as ChordOutputPort;
  const first=player.play(legacy,[60,64],1,600);
  assert.equal(piano.sent.length,1);
  player.stop();assert.equal(await first,false);
  const second=player.play(legacy,[60,67],1,900);
  t.mock.timers.tick(650);
  assert.equal(piano.sent.length,3); // The cancelled first chord has no late off.
  t.mock.timers.tick(350);assert.equal(await second,true);
  assert.deepEqual(piano.sent.at(-1)?.data,[0x80,60,0,0x80,67,0]);
});
