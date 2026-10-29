import {ReaderAudio} from './reader-audio.ts';
import {midiManager,type MidiManager} from './midi/manager.ts';

/** Shared chord playback for the reader and listening teacher. */
export class ChordPlayback {
  private audio=new ReaderAudio();
  private generation=0;
  private waitTimer:ReturnType<typeof setTimeout>|null=null;
  private finishWait:((done:boolean)=>void)|null=null;
  private ownsOutput=false;
  private midi:MidiManager;
  constructor(midi:MidiManager=midiManager){this.midi=midi;}
  unlock(){return this.midi.getSnapshot().selectedOutput?Promise.resolve(true):this.audio.unlock();}
  private wait(ms:number){
    return new Promise<boolean>(resolve=>{this.finishWait=resolve;this.waitTimer=setTimeout(()=>{this.waitTimer=null;this.finishWait=null;resolve(true);},ms);});
  }
  stop(){
    this.generation++;
    if(this.waitTimer!==null)clearTimeout(this.waitTimer);
    this.waitTimer=null;this.finishWait?.(false);this.finishWait=null;
    this.audio.stop('chord:');
    if(this.ownsOutput)this.midi.stopOutput();
    this.ownsOutput=false;
  }
  async play(chords:readonly (readonly number[])[],durationMs=800,gapMs=180):Promise<boolean>{
    this.stop();const generation=this.generation;
    const output=this.midi.getSnapshot().selectedOutput;
    if(!output&&!await this.audio.unlock())throw new Error('Sound could not start. Tap Hear again to enable audio.');
    if(generation!==this.generation)return false;
    for(let i=0;i<chords.length;i++){
      if(output!==this.midi.getSnapshot().selectedOutput)throw new Error('Sound output changed. Tap Hear again.');
      if(output){
        this.ownsOutput=true;
        if(!await this.midi.playOutputChord(chords[i],durationMs))return false;
      }else{
        chords[i].forEach(note=>this.audio.on('chord:'+note,note,.6));
        if(!await this.wait(durationMs))return false;
        this.audio.stop('chord:');
      }
      if(generation!==this.generation)return false;
      if(i<chords.length-1&&!await this.wait(gapMs))return false;
    }
    this.ownsOutput=false;
    // Keep playback echoes out of the answer window.
    return await this.wait(180)&&generation===this.generation;
  }
  dispose(){this.stop();this.audio.dispose();}
}
