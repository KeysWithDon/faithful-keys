/** Own only the notes sent for chord previews; never change the keyboard's patch. */
export type ChordOutputPort={
  id:string;state:'connected'|'disconnected';
  send(data:number[],timestamp?:number):void|Promise<void>;
  clear?:()=>void;supportsScheduling?:boolean;
};
type ActiveChord={
  port:ChordOutputPort;channel:number;notes:number[];
  finish:(completed:boolean)=>void;fail:(error:Error)=>void;
  timer?:ReturnType<typeof setTimeout>;offTimer?:ReturnType<typeof setTimeout>;
};
const isPromise=(value:void|Promise<void>):value is Promise<void>=>Boolean(value&&typeof value.then==='function');
export class MidiChordOutput {
  private active:ActiveChord|null=null;
  private changed:(playing:boolean)=>void;
  constructor(changed:(playing:boolean)=>void=()=>{}){this.changed=changed;}
  private release(active:ActiveChord):Promise<void>{
    try{
      active.port.clear?.();
      return Promise.resolve(active.port.send([0xb0|(active.channel-1),64,0,...active.notes.flatMap(note=>[0x80|(active.channel-1),note,0])])).catch(()=>{});
    }catch{return Promise.resolve();}
  }
  private cancelTimers(active:ActiveChord){
    if(active.timer!==undefined)clearTimeout(active.timer);
    if(active.offTimer!==undefined)clearTimeout(active.offTimer);
  }
  private failed(active:ActiveChord){
    if(this.active!==active)return;
    this.active=null;this.cancelTimers(active);void this.release(active);this.changed(false);
    active.fail(new Error('Could not send MIDI to your keyboard. Check the Bluetooth connection, output device and receive channel.'));
  }
  private completed(active:ActiveChord){
    if(this.active!==active)return;
    this.active=null;this.changed(false);active.finish(true);
  }
  private schedule(active:ActiveChord,duration:number){
    if(this.active!==active)return;
    // Reset sustain before note-offs so a phone instrument cannot latch the preview chord.
    const off=[0xb0|(active.channel-1),64,0,...active.notes.flatMap(note=>[0x80|(active.channel-1),note,0])];
    const queued=Boolean(active.port.clear&&active.port.supportsScheduling!==false);
    if(queued){
      try{
        const sent=active.port.send(off,performance.now()+duration);
        if(isPromise(sent))void sent.catch(()=>this.failed(active));
        active.timer=setTimeout(()=>this.completed(active),duration+100);
      }catch{this.failed(active);}
    }else{
      active.offTimer=setTimeout(()=>{
        if(this.active!==active)return;
        try{
          const sent=active.port.send(off);
          const finish=()=>{if(this.active===active)active.timer=setTimeout(()=>this.completed(active),100);};
          if(isPromise(sent))void sent.then(finish,()=>this.failed(active));else finish();
        }catch{this.failed(active);}
      },duration);
    }
  }
  play(port:ChordOutputPort,notes:readonly number[],channel=1,durationMs=850,velocity=.65):Promise<boolean>{
    void this.stop();
    const pitches=[...new Set(notes)].sort((a,b)=>a-b);
    if(port.state!=='connected')throw new Error('Your MIDI output is disconnected. Choose it again in MIDI Setup.');
    if(!pitches.length||pitches.some(n=>!Number.isInteger(n)||n<0||n>127))throw new Error('This chord contains an invalid MIDI note.');
    if(!Number.isInteger(channel)||channel<1||channel>16)throw new Error('Choose a MIDI channel from 1 to 16.');
    const ch=channel-1,level=Math.max(1,Math.min(127,Math.round(velocity*127)));
    const duration=Math.max(100,Math.min(10000,durationMs));
    return new Promise((resolve,reject)=>{
      const active:ActiveChord={port,channel,notes:pitches,finish:resolve,fail:reject};
      this.active=active;this.changed(true);
      try{
        // Always cancel old receiver-side sustain before preview notes.
        const sent=port.send([0xb0|ch,64,0,...pitches.flatMap(note=>[0x90|ch,note,level])]);
        if(isPromise(sent))void sent.then(()=>this.schedule(active,duration),()=>this.failed(active));
        else this.schedule(active,duration);
      }catch{this.failed(active);}
    });
  }
  stop():Promise<void>{
    const active=this.active;if(!active)return Promise.resolve();
    this.active=null;this.cancelTimers(active);
    const release=this.release(active);
    this.changed(false);active.finish(false);return release;
  }
}
