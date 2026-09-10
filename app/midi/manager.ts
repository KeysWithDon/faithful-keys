import { parseMidi, type NoteEvent } from './parser.ts';
export type MidiStatus = 'Permission Required' | 'Connected' | 'No Device Found' | 'Device Disconnected' | 'Browser Does Not Support MIDI' | 'Permission Denied' | 'Disabled';
export type MidiSnapshot = { status: MidiStatus; inputs: { id: string; name: string }[]; selected: string; active: number[]; enabled: boolean; inputMode: 'auto' | 'screen' | 'midi' };
export class MidiManager {
  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private held = new Map<string,NoteEvent>();
  private listeners = new Set<() => void>();
  private notes = new Set<(event: NoteEvent) => void>();
  private generation = 0;
  private snapshot: MidiSnapshot = { status: 'Permission Required', inputs: [], selected: '', active: [], enabled: false, inputMode: 'auto' };
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  onNote = (listener: (event: NoteEvent) => void) => { this.notes.add(listener); return () => { this.notes.delete(listener); }; };
  private publish(patch: Partial<MidiSnapshot>) { this.snapshot = {...this.snapshot,...patch}; this.listeners.forEach(f=>f()); }
  private preferences() {
    try { localStorage.setItem('faithful-keys-midi-v1',JSON.stringify({selected:this.snapshot.selected,enabled:this.snapshot.enabled,inputMode:this.snapshot.inputMode})); } catch { /* Optional device preference, no learning data. */ }
  }
  restore() {
    try { const data=JSON.parse(localStorage.getItem('faithful-keys-midi-v1') ?? '{}'); this.publish({selected:typeof data.selected==='string'?data.selected:'',inputMode:['auto','screen','midi'].includes(data.inputMode)?data.inputMode:'auto'}); } catch { /* Keep defaults. */ }
    if (!navigator.requestMIDIAccess) this.publish({status:'Browser Does Not Support MIDI'});
    // Deliberately never request access on page load, even if previously enabled.
  }
  setMode(inputMode: MidiSnapshot['inputMode']) { this.publish({inputMode}); this.preferences(); }
  async connect(request = () => navigator.requestMIDIAccess({sysex:false})) {
    const generation=++this.generation;
    try {
      const access=await request();
      if (generation!==this.generation) return;
      this.access=access; this.publish({enabled:true});
      access.onstatechange=()=>this.refresh(); this.refresh(); this.preferences();
    } catch (error) { this.publish({status: error instanceof Error && error.name==='NotAllowedError' ? 'Permission Denied' : 'Browser Does Not Support MIDI',enabled:false}); }
  }
  private clear() { this.held.clear(); this.publish({active:[]}); this.notes.forEach(f=>f({type:'panic',note:0,pitchClass:0,octave:0,velocity:0,channel:0,at:Date.now()})); }
  select(id: string) { this.publish({selected:id}); this.bind(); this.preferences(); }
  private refresh() {
    const inputs=Array.from(this.access?.inputs.values() ?? []).filter(i=>i.state==='connected').map(i=>({id:i.id,name:i.name??'MIDI keyboard'}));
    const selected=inputs.some(i=>i.id===this.snapshot.selected)?this.snapshot.selected:(inputs[0]?.id ?? '');
    this.publish({inputs,selected}); this.bind();
  }
  private bind() {
    const next=this.access?.inputs.get(this.snapshot.selected) ?? null;
    if (this.input===next && next?.state==='connected') return;
    if (this.input) this.input.onmidimessage=null;
    this.clear(); this.input=next?.state==='connected'?next:null;
    if (this.input) { this.input.onmidimessage=e=>this.receive(e.data,e.timeStamp); this.publish({status:'Connected'}); }
    else this.publish({status:this.snapshot.selected?'Device Disconnected':'No Device Found'});
  }
  receive(data: ArrayLike<number> | null, at: number) {
    const event=parseMidi(data,at); if (!event) return;
    const key=`${event.channel}:${event.note}`;
    if (event.type==='panic') { this.clear(); return; }
    if (event.type==='on') this.held.set(key,event);
    else { const start=this.held.get(key); event.duration=start?Math.max(0,at-start.at):0; this.held.delete(key); }
    // Audio and evaluation listeners run before React subscribers so a MIDI
    // note is heard and judged without waiting for a render pass.
    this.notes.forEach(f=>f(event));
    this.publish({active:[...new Set([...this.held.values()].map(e=>e.note))]});
  }
  disable() { ++this.generation; if(this.input)this.input.onmidimessage=null; if(this.access)this.access.onstatechange=null; this.input=null; this.clear(); this.publish({enabled:false,status:'Disabled'}); this.preferences(); }
}
export const midiManager = new MidiManager();
