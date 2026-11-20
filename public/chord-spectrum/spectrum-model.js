import {TYPES, lookupChord, movementOptions, resolutionPlan} from './harmony.js';

// Adjacent colors belong to adjacent chord families. Every root has its own
// permanent bubble; position, label and color never depend on the selection.
export const SPECTRUM = [
  ['M',8],['add9',14],['maj7',22],['maj9',28],['6',38],['69',44],
  ['aug',58],['augMaj7',68],
  ['sus2',86],['sus4',100],['7sus4',112],['9sus4',124],['13sus4',136],
  ['m',158],['m7',166],['m9',174],['m11',182],['m6',194],['m69',202],['mMaj7',212],
  ['half',229],['dim7',240],['dim',250],
  ['7',272],['9',282],['13',292],['13b9',305],['7b9',316],
  ['7s9',326],['7s5',336],['7b13',344],['alt',352]
];
export const ROOT_ORDER = [0,7,2,9,4,11,6,1,8,3,10,5];
export const SIZE = 3400;
export const chordKey = chord => `${chord.pc}:${chord.qualityId}`;
export const spectrumNodes = SPECTRUM.flatMap(([quality,hue],column) => ROOT_ORDER.map((pc,row) => {
  const chord = lookupChord(pc,quality), angle = column/SPECTRUM.length*Math.PI*2-Math.PI/2;
  const radius = 620+row*87;
  return {key:chordKey(chord),chord,column,row,hue,color:`hsl(${hue} 75% 70%)`,
    x:SIZE/2+Math.cos(angle)*radius,y:SIZE/2+Math.sin(angle)*radius};
}));
export const spectrumByKey = new Map(spectrumNodes.map(n => [n.key,n]));
const edgeMap = new Map();
function addEdge(from,to){
  const source=spectrumByKey.get(chordKey(from)),target=spectrumByKey.get(chordKey(to));
  if(!source||!target||source===target)return;
  const key=`${source.key}>${target.key}`;
  if(!edgeMap.has(key))edgeMap.set(key,{key,source,target});
}
for(const n of spectrumNodes){
  for(const option of movementOptions(n.chord))addEdge(n.chord,option.node);
  const plan=resolutionPlan(n.chord);
  for(let i=1;i<plan.steps.length;i++)addEdge(plan.steps[i-1],plan.steps[i]);
}
export const spectrumEdges = [...edgeMap.values()];

const normalize = text => text.toLowerCase().replaceAll('♯','#').replaceAll('♭','b')
  .replaceAll('°','dim').replaceAll('ø','m7b5').replace(/\s/g,'');
const pitchClasses={c:0,d:2,e:4,f:5,g:7,a:9,b:11};
export function findChords(query,limit=8){
  const q=normalize(query);if(!q)return [];
  const root=q.match(/^([a-g])([#b]?)(.*)$/);
  if(root){
    const pc=(pitchClasses[root[1]]+(root[2]==='#'?1:root[2]==='b'?-1:0)+12)%12;
    const suffix=root[3].replace('major','maj').replace('minor','m').replace(/^min/,'m');
    return spectrumNodes.filter(n=>n.chord.pc===pc).map(n=>{
      const symbol=normalize(TYPES[n.chord.qualityId].suffix),id=normalize(n.chord.qualityId);
      const score=!suffix?(n.chord.qualityId==='M'?0:1):symbol===suffix||id===suffix?0:symbol.startsWith(suffix)||id.startsWith(suffix)?1:9;
      return {n,score};
    }).filter(r=>r.score<9).sort((a,b)=>a.score-b.score).slice(0,limit).map(r=>r.n);
  }
  return spectrumNodes.filter(n=>normalize(n.chord.qualityName).includes(q)).slice(0,limit);
}
