/** Own only the notes sent for chord previews; never change the keyboard's patch. */
export type ChordOutputPort=Pick<MIDIOutput,'id'|'state'|'send'>&{clear?:()=>void};
export class MidiChordOutput {
  private active:{port:ChordOutputPort;channel:number;notes:number[];finish:(completed:boolean)=>void;timer:ReturnType<typeof setTimeout>;offTimer?:ReturnType<typeof setTimeout>}|null=null;
  private changed:(playing:boolean)=>void;
  constructor(changed:(playing:boolean)=>void=()=>{}){this.changed=changed;}
  play(port:ChordOutputPort,notes:readonly number[],channel=1,durationMs=850,velocity=.65):Promise<boolean>{
    this.stop();
    const pitches=[...new Set(notes)].sort((a,b)=>a-b);
    if(port.state!=='connected')throw new Error('Your MIDI output is disconnected. Choose it again in MIDI Setup.');
    if(!pitches.length||pitches.some(n=>!Number.isInteger(n)||n<0||n>127))throw new Error('This chord contains an invalid MIDI note.');
    if(!Number.isInteger(channel)||channel<1||channel>16)throw new Error('Choose a MIDI channel from 1 to 16.');
    const ch=channel-1,level=Math.max(1,Math.min(127,Math.round(velocity*127)));
    const duration=Math.max(100,Math.min(10000,durationMs));
    const off=pitches.flatMap(note=>[0x80|ch,note,0]);
    try{
      port.send(pitches.flatMap(note=>[0x90|ch,note,level]));
      // Schedule note-offs in the MIDI queue, including when a tab timer is late.
      if(port.clear)port.send(off,performance.now()+duration);
    }catch{
      try{port.clear?.();port.send(off);}catch{/* The device may have vanished. */}
      throw new Error('Could not play your keyboard. Check the output connection and MIDI channel.');
    }
    this.changed(true);
    return new Promise(resolve=>{
      const offTimer=port.clear?undefined:setTimeout(()=>{try{port.send(off);}catch{/* Disconnection. */}},duration);
      const timer=setTimeout(()=>{
        this.active=null;this.changed(false);resolve(true);
      },duration+100);
      this.active={port,channel,notes:pitches,finish:resolve,timer,offTimer};
    });
  }
  stop(){
    const active=this.active;if(!active)return;
    this.active=null;clearTimeout(active.timer);
    if(active.offTimer!==undefined)clearTimeout(active.offTimer);
    try{active.port.clear?.();active.port.send(active.notes.flatMap(note=>[0x80|(active.channel-1),note,0]));}catch{/* Disconnection. */}
    this.changed(false);active.finish(false);
  }
}
