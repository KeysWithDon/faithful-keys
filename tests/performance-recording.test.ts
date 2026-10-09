import test from 'node:test';
import assert from 'node:assert/strict';
import {PerformanceRecorder,performanceMidi,readPerformanceTakes,type PerformanceTake} from '../app/performance-recording.ts';
function take(data:Pick<PerformanceTake,'durationMs'|'events'>):PerformanceTake{return {id:'take-1',name:'Test performance',createdAt:'2026-10-09T17:00:00Z',...data};}
function decode(bytes:Uint8Array){
  let position=22,tick=0;const notes:{tick:number;status:number;note:number;velocity:number}[]=[];
  let end=0;
  while(position<bytes.length){
    let delta=0,byte=0;do{byte=bytes[position++];delta=delta*128+(byte&127);}while(byte&128);
    tick+=delta;const status=bytes[position++];
    if(status===255){const type=bytes[position++],length=bytes[position++];if(type===47)end=tick;position+=length;}
    else notes.push({tick,status,note:bytes[position++],velocity:bytes[position++]});
  }
  return {notes,end};
}

test('records simultaneous MIDI notes, velocity, channels and timing',()=>{
  const recorder=new PerformanceRecorder();recorder.begin(1000);
  recorder.receive('on',60,.5,2,1100);recorder.receive('on',64,.8,2,1100);
  recorder.receive('off',60,0,2,1350);
  const result=recorder.finish(1500);
  assert.equal(result.durationMs,500);
  assert.deepEqual(result.events.map(e=>[e.type,e.note,e.ms]),[['on',60,100],['on',64,100],['off',60,350],['off',64,500]]);
  assert.equal(result.events[0].channel,2);assert.equal(result.events[0].velocity,.5);
  assert.equal(recorder.active,false);
});

test('rearticulation and stop close notes without losing overlapping channels',()=>{
  const recorder=new PerformanceRecorder();recorder.begin(0);
  recorder.receive('on',60,.6,0,0);recorder.receive('on',60,.9,1,20);
  recorder.receive('on',60,.5,0,50);recorder.receive('off',60,0,0,70);
  recorder.receive('off',67,0,0,80);
  const events=recorder.finish(100).events;
  assert.deepEqual(events.map(e=>[e.type,e.channel,e.ms]),[['on',0,0],['on',1,20],['off',0,50],['on',0,50],['off',0,70],['off',1,100]]);
});

test('MIDI export preserves elapsed time, simultaneous chords, note-offs and final silence',()=>{
  const recorder=new PerformanceRecorder();recorder.begin(0);
  recorder.receive('on',60,.5,2,500);recorder.receive('on',64,.75,2,500);
  recorder.receive('off',60,0,2,1000);recorder.receive('off',64,0,2,1000);
  const bytes=performanceMidi(take(recorder.finish(2000)));
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'MThd');
  assert.deepEqual([...bytes.slice(8,14)],[0,0,0,1,1,224]);
  assert.equal(new TextDecoder().decode(bytes.slice(14,18)),'MTrk');
  const length=new DataView(bytes.buffer).getUint32(18);assert.equal(length,bytes.length-22);
  assert.deepEqual(decode(bytes),{notes:[{tick:480,status:0x92,note:60,velocity:64},{tick:480,status:0x92,note:64,velocity:95},{tick:960,status:0x82,note:60,velocity:0},{tick:960,status:0x82,note:64,velocity:0}],end:1920});
});

test('saved performances round-trip and malformed storage is rejected',()=>{
  const recorder=new PerformanceRecorder();recorder.begin(0,[60]);
  const saved=take(recorder.finish(200));
  assert.deepEqual(readPerformanceTakes(JSON.stringify([saved])),[saved]);
  assert.deepEqual(readPerformanceTakes('broken'),[]);
  assert.deepEqual(readPerformanceTakes(JSON.stringify([{...saved,events:[{type:'on',note:256,ms:0,velocity:1,channel:0}]}])),[]);
  assert.deepEqual(readPerformanceTakes(JSON.stringify([{...saved,durationMs:-1}])),[]);
});
