import test from 'node:test';
import assert from 'node:assert/strict';
import {ReaderAudio} from '../app/reader-audio.ts';

test('reader recording keeps silent gaps and captures MIDI without forcing monitor sound',async t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');});
  let clockStarts=0,clockStops=0,clockTarget:unknown;
  const connections=new Map<object,unknown[]>(),gains:{gain:{value:number}}[]=[];
  const connectable=()=>{
    const node={connect(target:unknown){connections.set(node,[...(connections.get(node)??[]),target]);},disconnect(){}};
    return node;
  };
  const stream={} as MediaStream,capture={stream};
  class Context{
    state='running';currentTime=0;sampleRate=48000;destination={};
    createBuffer(){return {};}
    createBufferSource(){return {...connectable(),start(){}};}
    createMediaStreamDestination(){return capture;}
    createConstantSource(){return {offset:{value:1},connect(target:unknown){clockTarget=target;},start(){clockStarts++;},stop(){clockStops++;},disconnect(){}};}
    createGain(){const node=Object.assign(connectable(),{gain:{value:1,setValueAtTime(value:number){this.value=value;},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}}});gains.push(node);return node;}
    createOscillator(){return {...connectable(),type:'sine',frequency:{value:0},start(){},stop(){},onended:null};}
    async close(){this.state='closed';}
  }
  Object.defineProperty(globalThis,'window',{configurable:true,value:{AudioContext:Context}});
  const audio=new ReaderAudio();assert.equal(await audio.unlock(),true);
  assert.equal(audio.recordingStream(),stream);assert.equal(clockStarts,1);assert.equal(clockTarget,capture);
  assert.equal(audio.recordingStream(),stream);assert.equal(clockStarts,1);
  audio.on('midi:0:60',60,.8);
  const voice=gains[0],monitor=gains[1];
  assert.equal(connections.get(voice)?.includes(capture),true);assert.equal(monitor.gain.value,0);
  audio.setMidiMonitor(true);assert.equal(monitor.gain.value,1);
  audio.setMidiMonitor(false);assert.equal(monitor.gain.value,0);
  assert.equal(connections.get(voice)?.includes(capture),true);
  audio.dispose();assert.equal(clockStops,1);
});
