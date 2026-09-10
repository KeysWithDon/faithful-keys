import { SCALES, scaleNoteNames } from '../ear-training.ts';
import { SKILL_MAP } from './registry.ts';
import { type Profile } from './model.ts';
export type Exercise = { id: string; prompt: string; expected: number[][]; labels: string[]; sequence: boolean; chordSequence?: boolean; bass?: number; choices?: string[]; answer?: string; playback: boolean; previous?: number[]; hint: string; octaveExact?: boolean; rhythm?: boolean };
export const NAMES = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const qualities: Record<string,number[]> = { major:[0,4,7],minor:[0,3,7],dim:[0,3,6],aug:[0,4,8],maj7:[0,4,7,11],'7':[0,4,7,10],m7:[0,3,7,10],dim7:[0,3,6,9],halfDim:[0,3,6,10],sus2:[0,2,7],sus4:[0,5,7],add9:[0,4,7,14],'9':[0,4,7,10,14],'11':[0,4,7,10,14,17],'13':[0,4,7,10,14,17,21],altered:[0,4,7,10,13],upper:[0,4,10,14,18,21] };
export function questionFor(id: string, p: Profile, recent: string[] = [], rng = Math.random): Exercise {
  const s=SKILL_MAP[id]; if(!s) throw new Error('Unknown skill');
  const record=p.skills[id];
  const roots=record?.exposures >= 8 ? Array.from({length:12},(_,i)=>i) : [0,5,10];
  const candidates=roots.map(root=>({root,weight: recent.at(-1)===`${id}:${root}`?.1:1+Math.min(2,Object.entries(record?.mistakes??{}).filter(([k])=>k.includes(NAMES[root])).reduce((n,[,v])=>n+v,0)*.15)}));
  let cursor=rng()*candidates.reduce((n,c)=>n+c.weight,0);
  const root=(candidates.find(c=>(cursor-=c.weight)<0)??candidates[0]).root;
  const base=48+root, tonic=NAMES[root];
  const q: Exercise={id:`${id}:${root}`,prompt:'',expected:[],labels:[],sequence:false,playback:false,hint:s.lesson};
  const choose=<T,>(items:T[])=>items[Math.floor(rng()*items.length)];
  if(s.kind==='rhythm') return {...q,prompt:'Tap four evenly spaced beats',rhythm:true};
  if(s.kind==='note') {
    const target=s.material==='fourths'?(root+5)%12:s.material==='fifths'?(root+7)%12:root;
    return {...q,prompt:s.material==='octaves'?`Play ${tonic}4`:(s.material==='fourths'||s.material==='fifths')?`Play the next note after ${tonic} in the circle of ${s.material}`:`Play ${tonic}`,expected:[[s.material==='octaves'?60+target:48+target]],octaveExact:s.material==='octaves',labels:[NAMES[target]]};
  }
  if(s.kind==='scale') {
    const scale=SCALES.find(scale=>scale.id===s.material)??SCALES[0];
    const notes=[...scale.intervalOffsets,12].map(n=>base+n);
    const descending=(record?.exposures??0)>4 && rng()>.5;
    return {...q,prompt:`Play ${tonic} ${scale.name} ${descending?'descending':'ascending'}`,sequence:true,expected:(descending?[...notes].reverse():notes).map(n=>[n]),labels:scaleNoteNames(scale,root),octaveExact:true};
  }
  if(s.kind==='theory') {
    const degree=choose([0,1,2,3,4,5,6]), offsets=[0,2,4,5,7,9,11];
    const roman=['I','ii','iii','IV','V','vi','vii°'][degree];
    return s.material==='numbers' ? {...q,prompt:`In ${tonic} major, which note is number ${degree+1}?`,choices:[...NAMES],answer:NAMES[(root+offsets[degree])%12]} : {...q,prompt:`What is the quality of ${roman} in a major key?`,choices:['Major','Minor','Diminished'],answer:degree===6?'Diminished':[1,2,5].includes(degree)?'Minor':'Major'};
  }
  if(s.kind==='progression') {
    const playbackCharts: [number,string][][]=[[[0,'major'],[5,'major'],[7,'major'],[0,'major']],[[0,'major'],[7,'major'],[9,'minor'],[5,'major']]];
    const charts: Record<string,[number,string][]>={basic:[[0,'major'],[5,'major'],[7,'major'],[0,'major']],worship:[[0,'major'],[7,'major'],[9,'minor'],[5,'major']],gospel:[[0,'maj7'],[9,'m7'],[2,'m7'],[7,'7']],jazz:[[2,'m7'],[7,'7'],[0,'maj7']],secondary:[[0,'major'],[2,'7'],[7,'major']],passing:[[0,'major'],[1,'dim7'],[2,'minor']],modulation:[[0,'major'],[9,'7'],[2,'major']],substitution:[[2,'m7'],[1,'7'],[0,'maj7']],reharm:[[0,'maj7'],[9,'7'],[2,'m7'],[1,'7'],[0,'maj7']],playback:choose(playbackCharts)};
    const chart=charts[s.material]??charts.basic;
    return {...q,prompt:s.material==='playback'?'Listen, then play the chord progression back':`Play this progression in ${tonic}`,expected:chart.map(([offset,type])=>qualities[type].map(n=>base+offset+n)),labels:chart.map(([offset,type])=>`${NAMES[(root+offset)%12]} ${type}`),chordSequence:true,playback:s.material==='playback'};
  }
  const type=s.material==='sevenths'?choose(['maj7','7','m7','halfDim','dim7']):s.material==='extensions'?choose(['9','11','13']):s.material==='sus'?choose(['sus2','sus4','add9']):['first','second','root','slash','triads','recognize'].includes(s.material)?(s.material==='recognize'?choose(['major','minor']):'major'):s.material;
  let notes=(qualities[type]??qualities.major).map(n=>base+n);
  const inversion=s.material==='first'||s.material==='slash'?1:s.material==='second'?2:0;
  for(let i=0;i<inversion;i++) notes=[...notes.slice(1),notes[0]+12];
  if(s.kind==='voice-leading') { const previous=(s.material==='sevenths'?[0,4,7,11]:[0,4,7]).map(n=>base+n); return {...q,prompt:`Move from ${tonic}${s.material==='sevenths'?'maj7':' major'} to ${NAMES[(root+9)%12]}${s.material==='sevenths'?'m7':' minor'} with minimal motion`,expected:[(s.material==='sevenths'?[0,4,7,9]:[0,4,9]).map(n=>base+n)],previous,labels:['Smooth voice leading']}; }
  return {...q,prompt:s.material==='recognize'?'Listen, then play the chord back':`Play ${tonic} ${type}${inversion?` — ${inversion===1?'first':'second'} inversion`:''}`,expected:[notes],labels:[`${tonic} ${type}`],bass:['first','second','root','slash'].includes(s.material)?Math.min(...notes):undefined,playback:s.material==='recognize'};
}
