export class ElectricPiano extends EventTarget {
  constructor(){
    super();this.context=null;this.buffers=new Map();this.pending=new Map();this.voices=[];this.request=0;this.volume=.7;this.room=.25;
    this.manifestPromise=fetch('audio/manifest.json').then(r=>{if(!r.ok)throw new Error('The piano samples could not be found.');return r.json();}).then(m=>(this.manifest=m));
    this.manifestPromise.catch(()=>{});
  }
  status(state,message=''){this.dispatchEvent(new CustomEvent('status',{detail:{state,message}}));}
  unlock(){
    if(!this.context){
      const AudioCtx=window.AudioContext||window.webkitAudioContext;
      if(!AudioCtx)throw new Error('This browser does not support audio. Try Safari, Chrome, or Edge.');
      const c=this.context=new AudioCtx();
      this.master=c.createGain();this.master.gain.value=this.volume*.8;
      this.bus=c.createGain();this.bus.gain.value=1;
      this.compressor=c.createDynamicsCompressor();this.compressor.threshold.value=-18;this.compressor.knee.value=18;this.compressor.ratio.value=3;this.compressor.attack.value=.012;this.compressor.release.value=.24;
      this.wet=c.createGain();this.wet.gain.value=this.room*.43;
      this.convolver=c.createConvolver();
      const seconds=1.75,impulse=c.createBuffer(2,Math.floor(c.sampleRate*seconds),c.sampleRate);
      let seed=2173;
      for(let channel=0;channel<2;channel++){const data=impulse.getChannelData(channel);for(let j=0;j<data.length;j++){seed=(seed*16807)%2147483647;data[j]=(seed/2147483647*2-1)*Math.pow(1-j/data.length,3.2)*.58;}}
      this.convolver.buffer=impulse;
      this.bus.connect(this.compressor);this.bus.connect(this.convolver);this.convolver.connect(this.wet);this.wet.connect(this.compressor);this.compressor.connect(this.master);this.master.connect(c.destination);
      // A source started inside the tap gesture also unlocks older iOS Web Audio.
      const blank=c.createBufferSource();blank.buffer=c.createBuffer(1,1,c.sampleRate);blank.connect(c.destination);blank.start();
    }
    return this.context.resume();
  }
  setVolume(value){this.volume=value;if(this.context)this.master.gain.setTargetAtTime(value*.8,this.context.currentTime,.03);}
  setRoom(value){this.room=value;if(this.context)this.wet.gain.setTargetAtTime(value*.43,this.context.currentTime,.08);}
  async bufferFor(sample){
    if(this.buffers.has(sample.url))return this.buffers.get(sample.url);
    if(!this.pending.has(sample.url))this.pending.set(sample.url,(async()=>{
      const r=await fetch(sample.url);if(!r.ok)throw new Error('A piano sample could not load. Check your connection and tap again.');
      const buffer=await this.context.decodeAudioData(await r.arrayBuffer());
      this.buffers.set(sample.url,buffer);return buffer;
    })().finally(()=>this.pending.delete(sample.url)));
    return this.pending.get(sample.url);
  }
  async play(voicing,duration=2.8){
    const request=++this.request;
    try{
      const resume=this.unlock();
      const manifest=await this.manifestPromise;await resume;
      const regions=voicing.notes.map((n,j)=>manifest.samples.find(s=>n>=s.low&&n<=s.high&&voicing.velocities[j]>=s.velocityLow&&voicing.velocities[j]<=s.velocityHigh));
      if(regions.some(x=>!x))throw new Error('This note is outside the piano’s sampled range.');
      if(regions.some(s=>!this.buffers.has(s.url)))this.status('loading','Loading the electric piano…');
      const buffers=await Promise.all(regions.map(s=>this.bufferFor(s)));
      if(request!==this.request)return false;
      const c=this.context,now=c.currentTime+.025;
      const held=new Map();
      if(!voicing.rearticulate)for(const note of voicing.notes){
        const voice=this.voices.find(v=>v.note===note&&!v.releasing&&v.start<=now&&v.end>now+.4&&v.naturalEnd>now+.6&&now-v.start<1.35);
        if(voice)held.set(note,voice);
      }
      for(const voice of [...this.voices])if(![...held.values()].includes(voice))this.releaseVoice(voice,.16);
      regions.forEach((sample,j)=>{
        if(held.has(voicing.notes[j])){
          const voice=held.get(voicing.notes[j]),end=Math.min(now+duration,voice.naturalEnd);
          const level=Math.max(.0001,voice.gain.gain.value);
          if(voice.gain.gain.cancelAndHoldAtTime)voice.gain.gain.cancelAndHoldAtTime(now);
          else{voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setValueAtTime(level,now);}
          voice.gain.gain.setValueAtTime(level,Math.max(now,end-.32));voice.gain.gain.exponentialRampToValueAtTime(.0001,end);
          voice.source.stop(end+.02);voice.end=end;return;
        }
        const source=c.createBufferSource(),gain=c.createGain(),start=now+voicing.offsets[j];
        source.buffer=buffers[j];source.playbackRate.value=2**((voicing.notes[j]-sample.midi+(sample.tuneCents||0)/100)/12);
        const velocityGain=.21*Math.sqrt(5/voicing.notes.length)*Math.pow(voicing.velocities[j]/80,1.05)*10**((sample.gainDb||0)/20);
        gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(velocityGain,start+.004);gain.gain.setValueAtTime(velocityGain,start+Math.max(.15,duration-.32));gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
        source.connect(gain);gain.connect(this.bus);source.start(start);source.stop(start+duration+.1);
        const voice={source,gain,level:velocityGain,start,note:voicing.notes[j],end:start+duration,naturalEnd:start+buffers[j].duration/source.playbackRate.value,releasing:false};this.voices.push(voice);
        source.onended=()=>{source.disconnect();gain.disconnect();this.voices=this.voices.filter(v=>v!==voice);};
      });
      this.lastVoicing=voicing;this.lastHeldCount=held.size;this.status('ready');return true;
    }catch(error){if(request===this.request)this.status('error',error.message||'The piano could not start. Tap again to retry.');return false;}
  }
  release(seconds=.25){
    if(!this.context)return;
    for(const voice of [...this.voices])this.releaseVoice(voice,seconds);
  }
  releaseVoice(v,seconds){
    if(!this.context||v.releasing)return;
    const now=this.context.currentTime;
    v.releasing=true;
      try{
        if(v.gain.gain.cancelAndHoldAtTime&&v.start<=now)v.gain.gain.cancelAndHoldAtTime(now);
        else{v.gain.gain.cancelScheduledValues(now);v.gain.gain.setValueAtTime(v.start>now?0:Math.max(.0001,v.gain.gain.value),now);}
        v.gain.gain.linearRampToValueAtTime(0,now+seconds);v.source.stop(now+seconds+.02);
      }catch{}
  }
  cancelPending(){this.request++;}
  stop(){this.request++;this.release(.07);}
}
