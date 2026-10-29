/* Faithful Keys · Live Harmonic Mirror — pure harmonic analysis */
export const NOTE_NAMES = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
export const KEY_NAMES = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
export const MAJOR_STEPS = [0,2,4,5,7,9,11];
export const MINOR_STEPS = [0,2,3,5,7,8,10];
const mod = (n,m=12) => ((n%m)+m)%m;
const PATTERNS = [
  ['maj7♯11',[0,4,6,7,11]],['7♯11',[0,4,6,7,10]],
  ['13',[0,2,4,7,9,10]],['m11',[0,2,3,5,7,10]],['11',[0,2,4,5,7,10]],
  ['maj9',[0,2,4,7,11]],['m9',[0,2,3,7,10]],['9',[0,2,4,7,10]],
  ['7♭9',[0,1,4,7,10]],['7♯9',[0,3,4,7,10]],
  ['6/9',[0,2,4,7,9]],['maj7',[0,4,7,11]],['m(maj7)',[0,3,7,11]],
  ['m7♭5',[0,3,6,10]],['dim7',[0,3,6,9]],['7sus4',[0,5,7,10]],
  ['m7',[0,3,7,10]],['7',[0,4,7,10]],['6',[0,4,7,9]],['m6',[0,3,7,9]],
  ['7♭5',[0,4,6,10]],['7♯5',[0,4,8,10]],
  ['add9',[0,2,4,7]],['m(add9)',[0,2,3,7]],
  ['',[0,4,7]],['m',[0,3,7]],['dim',[0,3,6]],['aug',[0,4,8]],
  ['sus2',[0,2,7]],['sus4',[0,5,7]]
];
export function pitchClass(note) { return mod(note); }
export function noteName(pc) { return NOTE_NAMES[mod(pc)]; }
export function midiName(note) {
  return noteName(note) + (Math.floor(note/12)-1);
}
export function scalePcs(key=0,mode='major') {
  return (mode==='minor'?MINOR_STEPS:MAJOR_STEPS).map(i=>mod(key+i));
}
export function sharedKeys(from,to,mode='major') {
  const a=scalePcs(from,mode),b=new Set(scalePcs(to,mode));
  return a.filter(x=>b.has(x));
}
export function recognizeChord(notes,key=0,mode='major') {
  const valid=Array.from(new Set(notes.filter(n=>Number.isInteger(n)&&n>=21&&n<=108))).sort((a,b)=>a-b);
  const pcs=[...new Set(valid.map(pitchClass))].sort((a,b)=>a-b);
  if(!pcs.length) return {label:'—',kind:'empty',notes:valid,pcs,root:null,quality:'',function:'Play a chord to reveal its function',alternatives:[]};
  if(pcs.length===1) return {label:noteName(pcs[0]),kind:'note',notes:valid,pcs,root:null,quality:'',function:'Single note',alternatives:[]};
  if(pcs.length===2) {
    const interval=mod(pcs[1]-pcs[0]);
    return {label:'Two-note interval',kind:'interval',notes:valid,pcs,root:null,quality:'',function:noteName(pcs[0])+' and '+noteName(pcs[1])+' · '+Math.min(interval,12-interval)+' semitones apart (pitch classes)',alternatives:[]};
  }
  const bass=mod(valid[0]);
  const matches=[];
  for(let root=0;root<12;root++){
    const normalized=pcs.map(pc=>mod(pc-root)).sort((a,b)=>a-b);
    for(const [quality,intervals] of PATTERNS) {
      if(intervals.length!==normalized.length) continue;
      if(intervals.every((p,i)=>p===normalized[i])) {
        const diatonic=scalePcs(key,mode).includes(root);
        const score=(root===bass?10:0)+(diatonic?4:0)+(quality==='dim7'||quality==='aug'?0:1);
        matches.push({root,quality,score});
      }
    }
  }
  matches.sort((a,b)=>b.score-a.score||a.root-b.root);
  if(!matches.length) return {label:'Unclassified note cluster',kind:'cluster',notes:valid,pcs,root:null,quality:'',function:'No exact supported chord match; explore the intervals instead',alternatives:[]};
  const best=matches[0];
  const format=(m)=>noteName(m.root)+m.quality+(m.root!==bass?'/'+noteName(bass):'');
  const label=format(best);
  const degree=scalePcs(key,mode).indexOf(best.root);
  const majorRomans=['I','ii','iii','IV','V','vi','vii°'];
  const minorRomans=['i','ii°','III','iv','v','VI','VII'];
  const expected=(mode==='major'?['','m','m','','','m','dim']:['m','dim','','m','m','','']);
  let func;
  if(degree<0) func='Chromatic root in '+KEY_NAMES[mod(key)]+' '+mode+' · consider borrowed or secondary harmony';
  else {
    const base=(mode==='major'?majorRomans:minorRomans)[degree];
    const triad=best.quality.startsWith('m7♭5')?'dim':best.quality.startsWith('dim')?'dim':best.quality.startsWith('m')?'m':best.quality==='aug'?'aug':'';
    const inFamily=triad===expected[degree]||best.quality==='sus2'||best.quality==='sus4'||best.quality==='7sus4';
    func=base+' chord root in '+KEY_NAMES[mod(key)]+' '+mode+(inFamily?'':' · altered or borrowed quality');
  }
  return {label,kind:'chord',notes:valid,pcs,root:best.root,quality:best.quality,function:func,alternatives:[...new Set(matches.slice(1).map(format))].filter(x=>x!==label).slice(0,3)};
}
export function voiceLeading(before,after){
  const old=[...new Set(before)].sort((a,b)=>a-b), now=[...new Set(after)].sort((a,b)=>a-b);
  const oldLeft=new Set(old),newLeft=new Set(now),held=[],moved=[];
  for(const n of old){if(newLeft.has(n)){held.push(n);oldLeft.delete(n);newLeft.delete(n);}}
  while(oldLeft.size&&newLeft.size){
    let pair=null;
    for(const a of oldLeft)for(const b of newLeft){
      const cost=Math.abs(b-a);
      if(!pair||cost<pair.cost||(cost===pair.cost&&a<pair.from))pair={from:a,to:b,delta:b-a,cost};
    }
    moved.push({from:pair.from,to:pair.to,delta:pair.delta});
    oldLeft.delete(pair.from);newLeft.delete(pair.to);
  }
  return {held,moved,added:[...newLeft].sort((a,b)=>a-b),released:[...oldLeft].sort((a,b)=>a-b)};
}
