import {readerKeyboardRange, readerWrittenNote} from './chord-reader-notation.ts';
import type {PerformanceTake} from './performance-recording.ts';

export type ReaderTake = PerformanceTake & {video?: Blob; draft?: boolean};
export type ReaderVideoFrame = {
  notes: number[]; chord?: string; label: string; detail: string;
  spelling: string; sustain: boolean; sustained: number[];
};
export const readerVideoMimeTypes = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
export function readerVideoExtension(type: string) {return type.startsWith('video/mp4') ? 'mp4' : 'webm';}
export function readerVideoSupported() {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}
const duration = (ms: number) => `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
const keys = readerKeyboardRange();
const whites = keys.filter(n => ![1,3,6,8,10].includes(n%12));
const blacks = keys.filter(n => [1,3,6,8,10].includes(n%12));

/** Capture only the live reader, without recording other tabs or device screens.
 * The same note spelling, staff positions and keyboard range drive the UI and video.
 */
export function drawReaderVideo(ctx: CanvasRenderingContext2D, frame: ReaderVideoFrame, elapsed: number) {
  ctx.fillStyle = '#f6f3eb'; ctx.fillRect(0,0,1280,720);
  const text = (value: string, x: number, y: number, size=20, color='#142241', maxWidth=1180) => {
    ctx.fillStyle=color;ctx.font=`${size>=30?600:400} ${size}px sans-serif`;
    ctx.fillText(value,x,y,maxWidth);
  };
  text('FAITHFUL KEYS · CHORD READER',42,43,18);
  text(duration(elapsed),1150,43,18);
  ctx.textAlign='center';text(frame.label,640,111,44);
  text(frame.detail,640,143,16,'#665f56');ctx.textAlign='left';
  ctx.strokeStyle='#d7d1c5';ctx.beginPath();ctx.moveTo(42,167);ctx.lineTo(1238,167);ctx.stroke();
  text('CHORD STAFF',56,199,15);text('CHORD SPELLING',774,199,15);
  text(frame.spelling||'—',774,241,30,'#142241',455);
  text('NOTES PLAYED',774,292,15);
  const written=frame.notes.map(note=>readerWrittenNote(note,frame.chord));
  const names=written.map(n=>n.name+n.octave);
  for(let i=0;i<names.length;i+=8)text(names.slice(i,i+8).join(' · '),774,326+Math.floor(i/8)*26,20,'#142241',455);
  if(written.length)text(`Bass: ${names[0]}`,774,410,18);
  ctx.save();ctx.translate(52,205);ctx.scale(1.36,1.04);
  ctx.strokeStyle='#142241';ctx.lineWidth=.8;
  for(const y of [48,60,72,84,96,120,132,144,156,168]){ctx.beginPath();ctx.moveTo(25,y);ctx.lineTo(480,y);ctx.stroke();}
  ctx.fillStyle='#142241';ctx.font='64px "Noto Music", "Segoe UI Symbol", serif';ctx.fillText('𝄞',38,89);
  ctx.font='48px "Noto Music", "Segoe UI Symbol", serif';ctx.fillText('𝄢',38,157);
  written.forEach((note,index)=>{
    if(note.y<16||note.y>204)return;
    const neighbor=written.slice(0,index).filter(n=>n.treble===note.treble&&Math.abs(n.position-note.position)<=1).length;
    const x=260+(neighbor%2)*15;
    for(const [start,step] of [[(note.treble?48:120)-12,-12],[(note.treble?96:168)+12,12]]){
      for(let y=start;step<0?y>=note.y:y<=note.y;y+=step){ctx.beginPath();ctx.moveTo(x-19,y);ctx.lineTo(x+19,y);ctx.stroke();}
    }
    if(note.accidental){ctx.font='21px serif';ctx.fillText(note.accidental,220-(index%4)*18,note.y+5);}
    ctx.beginPath();ctx.ellipse(x,note.y,10,4.5,-Math.PI/12,0,Math.PI*2);ctx.fill();
  });
  ctx.font='12px sans-serif';
  if(written.some(n=>n.y<16))ctx.fillText('↑ '+written.filter(n=>n.y<16).map(n=>n.name+n.octave).join(' '),240,12,260);
  if(written.some(n=>n.y>204))ctx.fillText('↓ '+written.filter(n=>n.y>204).map(n=>n.name+n.octave).join(' '),240,218,260);
  ctx.restore();
  text('KEYBOARD · C2–C6',52,467,15);
  text(`Sustain ${frame.sustain?'ON · pedal-held notes stay active':'off'}`,800,467,17,frame.sustain?'#906b18':'#665f56',430);
  ctx.fillStyle='#142241';ctx.fillRect(42,480,1196,193);
  const keyWidth=1176/whites.length;
  whites.forEach((note,index)=>{
    const x=52+index*keyWidth;
    ctx.fillStyle=frame.notes.includes(note)?frame.sustained.includes(note)?'#d5af55':'#a6bbdb':'#fffefa';
    ctx.fillRect(x+1,490,keyWidth-2,169);
    const name=readerWrittenNote(note);text(name.name+name.octave,x+5,646,12,'#142241',keyWidth-5);
  });
  blacks.forEach(note=>{
    const x=52+whites.findIndex(n=>n>note)*keyWidth-keyWidth*.31;
    ctx.fillStyle=frame.notes.includes(note)?frame.sustained.includes(note)?'#b58a2a':'#6786b6':'#172034';
    ctx.fillRect(x,490,keyWidth*.62,104);
    const name=readerWrittenNote(note);text(name.name+name.octave,x+2,583,9,'#fff',keyWidth*.58);
  });
  text(frame.sustained.length?'Gold keys · held by sustain pedal':'Play your keyboard or the on-screen piano',52,704,16,'#665f56');
}

export class ReaderVideoRecorder {
  private recorder: MediaRecorder | null=null;
  private stream: MediaStream | null=null;
  private frame: number | null=null;
  private result: Promise<Blob> | null=null;
  active=false;

  begin(getFrame: () => ReaderVideoFrame, audio: MediaStream, onError: () => void) {
    if(this.active)throw new Error('A reader recording is already running.');
    if(!readerVideoSupported())throw new Error('Video recording is unavailable in this browser. Try an updated Safari, Chrome or Edge.');
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('The reader video could not start.');
    const began=performance.now();
    drawReaderVideo(ctx,getFrame(),0);
    try {
      this.stream=canvas.captureStream(30);
      for(const track of audio.getAudioTracks())this.stream.addTrack(track.clone());
      const mimeType=readerVideoMimeTypes.find(type=>MediaRecorder.isTypeSupported(type));
      this.recorder=new MediaRecorder(this.stream,{...(mimeType?{mimeType}:{}),videoBitsPerSecond:3_000_000});
      const recorder=this.recorder;
      const chunks:Blob[]=[];
      this.result=new Promise((resolve,reject)=>{
        recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
        recorder.onerror=()=>{this.cleanup();reject(new Error('Video recording stopped unexpectedly. Please try a shorter take.'));onError();};
        recorder.onstop=()=>{
          this.cleanup();
          if(chunks.length)resolve(new Blob(chunks,{type:recorder.mimeType||chunks[0].type}));
          else reject(new Error('No video was captured. Please try Record again.'));
        };
      });
      // Errors may arrive before the person presses Stop.
      void this.result.catch(()=>undefined);
      recorder.start(1000);this.active=true;
      let lastFrame:ReaderVideoFrame|null=null,lastSecond=-1,lastPaint=-Infinity;
      const paint=()=>{
        if(!this.active)return;
        const now=performance.now();
        if(now-lastPaint>=1000/30){
          const snapshot=getFrame(),ms=now-began,second=Math.floor(ms/1000);
          if(snapshot!==lastFrame||second!==lastSecond){drawReaderVideo(ctx,snapshot,ms);lastFrame=snapshot;lastSecond=second;}
          else{
            // Keep static holds in the video timeline without redrawing the staff.
            ctx.fillStyle='#f6f3eb';ctx.fillRect(0,0,1,1);
          }
          lastPaint=now;
        }
        this.frame=requestAnimationFrame(paint);
      };
      this.frame=requestAnimationFrame(paint);
    }catch(error){this.cleanup();throw error;}
  }
  async finish() {
    if(!this.result)throw new Error('No video recording is running.');
    if(this.recorder?.state!=='inactive')this.recorder?.stop();
    return this.result;
  }
  private cleanup() {
    this.active=false;
    if(this.frame!==null)cancelAnimationFrame(this.frame);
    this.frame=null;this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
  }
}

/** Video blobs belong in IndexedDB rather than localStorage's small text quota. */
function videoStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('Video storage is unavailable.'));return;}
    const request=indexedDB.open('faithful-keys-reader-videos-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('takes',{keyPath:'id'});
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Close other Faithful Keys tabs and retry saving.'));
    request.onsuccess=()=>{
      const db=request.result;
      try{
        const transaction=db.transaction('takes',mode),operation=run(transaction.objectStore('takes'));
        transaction.oncomplete=()=>{db.close();resolve(operation.result);};
        transaction.onerror=transaction.onabort=()=>{db.close();reject(transaction.error??new Error('Could not save video on this device.'));};
      }catch(error){db.close();reject(error);}
    };
  });
}
export async function loadReaderVideos() {
  const takes=await videoStore<ReaderTake[]>('readonly',store=>store.getAll());
  return takes.filter(take=>take.video instanceof Blob).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function saveReaderVideo(take: ReaderTake) {await videoStore('readwrite',store=>store.put(take));}
export async function deleteReaderVideo(id: string) {await videoStore('readwrite',store=>store.delete(id));}
