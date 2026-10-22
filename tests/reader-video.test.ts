import test from 'node:test';
import assert from 'node:assert/strict';
import {ReaderVideoRecorder, readerVideoSupported, readerVideoExtension, type ReaderVideoFrame} from '../app/reader-video.ts';

const frame:ReaderVideoFrame={notes:[60,64,67],chord:'C',label:'C',detail:'',spelling:'C · E · G',sustain:true,sustained:[60]};

test('video capture preserves audio ownership, outputs a video blob and releases capture resources',async t=>{
  const original=new Map<string,PropertyDescriptor|undefined>();
  const replace=(name:string,value:unknown)=>{original.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,value});};
  t.after(()=>{for(const [name,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});
  let videoStops=0,audioStops=0,originalAudioStops=0,cancelled=0;
  const tracks=[{stop(){videoStops++;}}];
  const stream={getTracks:()=>tracks,addTrack:(track:{stop:()=>void})=>tracks.push(track)};
  const ctx=new Proxy({}, {get:()=>()=>undefined,set:()=>true});
  class Canvas{width=0;height=0;getContext(){return ctx;}captureStream(){return stream;}}
  class Recorder{
    static isTypeSupported(type:string){return type==='video/webm';}
    state='inactive';mimeType='video/webm';
    ondataavailable:((event:{data:Blob})=>void)|null=null;
    onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['video data'],{type:this.mimeType})});this.onstop?.();}
  }
  replace('HTMLCanvasElement',Canvas);replace('MediaRecorder',Recorder);
  replace('document',{createElement:()=>new Canvas()});
  replace('requestAnimationFrame',()=>1);replace('cancelAnimationFrame',()=>{cancelled++;});
  const audio={getAudioTracks:()=>[{stop(){originalAudioStops++;},clone:()=>({stop(){audioStops++;}})}]} as unknown as MediaStream;
  const recorder=new ReaderVideoRecorder();assert.equal(readerVideoSupported(),true);
  recorder.begin(()=>frame,audio,()=>assert.fail('Unexpected encoder failure'));
  assert.equal(recorder.active,true);
  const blob=await recorder.finish();assert.equal(blob.type,'video/webm');assert.equal(blob.size,10);
  assert.equal(recorder.active,false);assert.equal(videoStops,1);assert.equal(audioStops,1);assert.equal(originalAudioStops,0);assert.equal(cancelled,1);
  assert.equal(readerVideoExtension('video/mp4;codecs=avc1'),'mp4');assert.equal(readerVideoExtension(blob.type),'webm');
});

test('unsupported video capture reports a clear failure rather than pretending to record',()=>{
  assert.equal(readerVideoSupported(),false);
  const recorder=new ReaderVideoRecorder();
  assert.throws(()=>recorder.begin(()=>frame,{} as MediaStream,()=>{}),/Video recording is unavailable/);
});
