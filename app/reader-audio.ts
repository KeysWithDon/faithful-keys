import { createInteractiveAudioContext, resumeAudioFromGesture } from './mobile-audio.ts';

/** A separate polyphonic monitor keeps held notes sounding until note-off. */
export class ReaderAudio {
  private context:AudioContext|null=null;
  private capture:MediaStreamAudioDestinationNode|null=null;
  private midiOutput:GainNode|null=null;
  private monitor=false;
  private voices=new Map<string,{oscillators:OscillatorNode[];gain:GainNode}>();
  unlock(){
    try{
      const next=createInteractiveAudioContext(window as typeof window & {webkitAudioContext?:typeof AudioContext},this.context);
      if(next!==this.context){this.stop();this.capture=null;this.midiOutput=null;}
      this.context=next;
      return next?resumeAudioFromGesture(next):Promise.resolve(false);
    }catch{return Promise.resolve(false);}
  }
  setMidiMonitor(enabled:boolean){
    this.monitor=enabled;
    if(this.midiOutput&&this.context)this.midiOutput.gain.setValueAtTime(enabled?1:0,this.context.currentTime);
  }
  recordingStream(){
    const ctx=this.context;
    if(!ctx||ctx.state!=='running')throw new Error('Tap Record again to enable piano audio.');
    if(!this.capture){
      this.capture=ctx.createMediaStreamDestination();
      for(const voice of this.voices.values())voice.gain.connect(this.capture);
    }
    return this.capture.stream;
  }
  on(key:string,note:number,velocity=.7){
    const ctx=this.context;if(!ctx||ctx.state!=='running')return;
    this.off(key);
    const gain=ctx.createGain();
    if(key.startsWith('midi:')){
      if(!this.midiOutput){this.midiOutput=ctx.createGain();this.midiOutput.gain.value=this.monitor?1:0;this.midiOutput.connect(ctx.destination);}
      gain.connect(this.midiOutput);
    }else gain.connect(ctx.destination);
    if(this.capture)gain.connect(this.capture);
    const start=ctx.currentTime;
    const peak=Math.max(.005,velocity*.08);
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(peak,start+.003);gain.gain.exponentialRampToValueAtTime(peak*.45,start+.25);
    const frequency=440*Math.pow(2,(note-69)/12);
    const fundamental=ctx.createOscillator();fundamental.type='sine';fundamental.frequency.value=frequency;fundamental.connect(gain);fundamental.start();
    const overtone=ctx.createOscillator();overtone.type='sine';overtone.frequency.value=frequency*2;
    const color=ctx.createGain();color.gain.value=.15;overtone.connect(color);color.connect(gain);overtone.start();
    this.voices.set(key,{oscillators:[fundamental,overtone],gain});
  }
  off(key:string){
    const voice=this.voices.get(key),ctx=this.context;if(!voice||!ctx)return;
    this.voices.delete(key);
    const now=ctx.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(0,now,.025);
    voice.oscillators.forEach(osc=>osc.stop(now+.15));
    voice.oscillators[0].onended=()=>{voice.oscillators.forEach(osc=>osc.disconnect());voice.gain.disconnect();};
  }
  stop(prefix=''){for(const key of this.voices.keys())if(key.startsWith(prefix))this.off(key);}
  dispose(){this.stop();if(this.context&&this.context.state!=='closed')void this.context.close().catch(()=>undefined);this.context=null;this.capture=null;this.midiOutput=null;}
}
