export type PerformanceEvent = {type:'on'|'off';note:number;velocity:number;channel:number;ms:number};
export type PerformanceTake = {id:string;name:string;createdAt:string;durationMs:number;events:PerformanceEvent[]};
export const PERFORMANCE_STORAGE_KEY='faithful-keys-performances-v1';

export class PerformanceRecorder {
  private start=0;
  private events:PerformanceEvent[]=[];
  private held=new Map<string,PerformanceEvent>();
  active=false;
  begin(now:number,notes:readonly number[]=[]) {
    this.start=now;this.events=[];this.held.clear();this.active=true;
    notes.forEach(note=>this.receive('on',note,.75,0,now));
  }
  receive(type:'on'|'off'|'panic',note:number,velocity:number,channel:number,now:number) {
    if(!this.active)return;
    const ms=Math.max(0,Math.round(now-this.start));
    if(type==='panic'){
      for(const held of this.held.values())this.events.push({...held,type:'off',velocity:0,ms});
      this.held.clear();return;
    }
    if(!Number.isInteger(note)||note<0||note>127)return;
    const key=channel+':'+note;
    const event:PerformanceEvent={type,note,velocity:Math.max(0,Math.min(1,velocity)),channel:channel&15,ms};
    if(type==='on'){
      const previous=this.held.get(key);
      if(previous)this.events.push({...previous,type:'off',velocity:0,ms});
      this.held.set(key,event);
    }else{
      if(!this.held.has(key))return;
      this.held.delete(key);
    }
    this.events.push(event);
  }
  finish(now:number):Pick<PerformanceTake,'durationMs'|'events'> {
    this.receive('panic',0,0,0,now);this.active=false;
    return {durationMs:Math.max(0,Math.round(now-this.start)),events:[...this.events]};
  }
}

export function readPerformanceTakes(raw:string|null):PerformanceTake[] {
  if(!raw)return [];
  try{
    const value:unknown=JSON.parse(raw);
    if(!Array.isArray(value))return [];
    return value.filter((take):take is PerformanceTake=>{
      if(!take||typeof take!=='object')return false;
      const t=take as PerformanceTake;
      return typeof t.id==='string'&&typeof t.name==='string'&&typeof t.createdAt==='string'&&Number.isFinite(t.durationMs)&&t.durationMs>=0&&Array.isArray(t.events)&&t.events.every(e=>e&&(e.type==='on'||e.type==='off')&&Number.isInteger(e.note)&&e.note>=0&&e.note<=127&&Number.isFinite(e.ms)&&e.ms>=0&&e.ms<=t.durationMs&&Number.isFinite(e.velocity)&&e.velocity>=0&&e.velocity<=1&&Number.isInteger(e.channel)&&e.channel>=0&&e.channel<=15);
    });
  }catch{return [];}
}

function variableLength(value:number){
  const bytes=[value&127];
  while((value=Math.floor(value/128))>0)bytes.unshift((value&127)|128);
  return bytes;
}
function uint32(value:number){return [value>>>24&255,value>>>16&255,value>>>8&255,value&255];}
/** Type-0 SMF, 480 ticks per beat, fixed 120 BPM (960 ticks per second). */
export function performanceMidi(take:PerformanceTake):Uint8Array {
  const track:number[]=[0,0xff,0x51,3,7,0xa1,0x20];
  let tick=0;
  for(const event of [...take.events].sort((a,b)=>a.ms-b.ms)){
    const next=Math.max(tick,Math.round(event.ms*.96));
    track.push(...variableLength(next-tick),(event.type==='on'?0x90:0x80)|event.channel,event.note,event.type==='on'?Math.max(1,Math.round(event.velocity*127)):0);
    tick=next;
  }
  const end=Math.max(tick,Math.round(take.durationMs*.96));
  track.push(...variableLength(end-tick),0xff,0x2f,0);
  return new Uint8Array([0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,1,0xe0,0x4d,0x54,0x72,0x6b,...uint32(track.length),...track]);
}
