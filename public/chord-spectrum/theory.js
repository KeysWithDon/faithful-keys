// Five positions per major-key sector, preserving the supplied wheel's layout.
export const COLORS={major:'#ed8eae',minor:'#89cde9',dominant:'#e8c87b',diminished:'#bc9aeb'};
export const KEYS=[['C',0,'Am','G7','E7','B°'],['G',7,'Em','D7','B7','F♯°'],['D',2,'Bm','A7','F♯7','C♯°'],['A',9,'F♯m','E7','C♯7','G♯°'],['E',4,'C♯m','B7','G♯7','D♯°'],['B',11,'G♯m','F♯7','D♯7','A♯°'],['F♯',6,'D♯m','C♯7','A♯7','E♯°'],['D♭',1,'B♭m','A♭7','F7','C°'],['A♭',8,'Fm','E♭7','C7','G°'],['E♭',3,'Cm','B♭7','G7','D°'],['B♭',10,'Gm','F7','D7','A°'],['F',5,'Dm','C7','A7','E°']];
export const mod=(n,m=12)=>((n%m)+m)%m;
export const nodes=KEYS.flatMap((k,i)=>[
 {id:`M${i}`,sector:i,label:k[0],pc:k[1],type:'major',radius:471,angle:-97.5+i*30},
 {id:`m${i}`,sector:i,label:k[2],pc:mod(k[1]+9),type:'minor',radius:471,angle:-82.5+i*30},
 {id:`V${i}`,sector:i,label:k[3],pc:mod(k[1]+7),type:'dominant',radius:341,angle:-97.5+i*30},
 {id:`v${i}`,sector:i,label:k[4],pc:mod(k[1]+4),type:'dominant',radius:341,angle:-82.5+i*30},
 {id:`d${i}`,sector:i,label:k[5],pc:mod(k[1]+11),type:'diminished',radius:211,angle:-90+i*30}
].map(n=>({...n,x:560+Math.cos(n.angle*Math.PI/180)*n.radius,y:560+Math.sin(n.angle*Math.PI/180)*n.radius})));
export const byId=Object.fromEntries(nodes.map(n=>[n.id,n]));
export const tones=n=>({major:[0,4,7],minor:[0,3,7],dominant:[0,4,7,10],diminished:[0,3,6,9]}[n.type].map(t=>mod(n.pc+t)));
export const signature=n=>n.type==='diminished'?`dim:${mod(n.pc,3)}`:`${n.type}:${n.pc}`;
export const sameHarmony=(a,b)=>signature(a)===signature(b);
export const edges=[];
const edge=(a,b,kind,both=false,bend=0)=>edges.push({id:`${a}-${b}`,a,b,kind,both,bend});
for(let i=0;i<12;i++){
 edge(`M${i}`,`m${i}`,'relative',true,-.20);
 edge(`M${i}`,`V${i}`,'dominant-major',true,.14);
 edge(`m${i}`,`v${i}`,'dominant-minor',true,-.14);
 edge(`M${i}`,`v${i}`,'secondary',false,-.12);
 edge(`m${i}`,`V${mod(i+1)}`,'two-five',false,.12);
 edge(`V${i}`,`d${i}`,'rootless',true,.08);
 edge(`v${i}`,`d${i}`,'rootless',true,-.08);
 edge(`d${i}`,`M${mod(i+1)}`,'common-tone',false,-.16);
 edge(`d${i}`,`d${mod(i+3)}`,'symmetry',true,0);
}
export function directRelation(from,to){
 for(const e of edges){
  if(e.kind==='symmetry')continue;
  if(sameHarmony(byId[e.a],from)&&sameHarmony(byId[e.b],to))return {...e,from:from.id,to:to.id,reversed:false};
  if(e.both&&sameHarmony(byId[e.b],from)&&sameHarmony(byId[e.a],to))return {...e,from:from.id,to:to.id,reversed:true};
 }
 return null;
}
export function optionsFor(from){
 const options=new Map();
 for(const e of edges){
  for(const reverse of e.both?[false,true]:[false]){
   const origin=byId[reverse?e.b:e.a],target=byId[reverse?e.a:e.b];
   if(!sameHarmony(origin,from)||sameHarmony(from,target))continue;
   const key=signature(target),info={node:target,relation:{...e,reversed:reverse,from:from.id,to:target.id}};
   const old=options.get(key);
   if(!old||Math.abs(target.sector-from.sector)<Math.abs(old.node.sector-from.sector))options.set(key,info);
  }
 }
 const priorities={'dominant-major':0,'dominant-minor':0,relative:1,secondary:2,'two-five':2,rootless:3,'common-tone':4};
 return [...options.values()].sort((a,b)=>(priorities[a.relation.kind]??5)-(priorities[b.relation.kind]??5));
}
export function relationCopy(relation,from,to){
 const k=relation?.kind;
 if(k==='relative')return {title:to.type==='minor'?'Relative minor':'Relative major',hint:'A different shade of home',text:`${from.label} and ${to.label} are relative chords. Their basic triads share two notes and belong to the same major/minor key pair. This is a gentle change of color; it does not automatically establish a new key.`};
 if(k==='dominant-major'||k==='dominant-minor'){
  const resolves=from.type==='dominant';
  return {title:resolves?(to.type==='minor'?'Resolve to minor':'Resolve to major'):'Build a little tension',hint:resolves?'5 → 1 · release':'1 → 5 · anticipation',text:resolves?`${from.label} is the dominant of ${to.label}. The root moves down a fifth (or up a fourth), and its third points up to the new home note. Listen for tension turning into arrival.`:`${to.label} is the dominant that leads back to ${from.label}. Going there creates a little expectation; playing ${to.label} and then ${from.label} lets you hear the release.`};
 }
 if(k==='secondary')return {title:'Open a minor doorway',hint:'A dominant for the relative minor',text:`${from.label} to ${to.label} introduces the dominant of the relative minor. In this sector, ${to.label} can resolve to ${byId[`m${from.sector}`].label}. A chromatic leading tone makes the minor arrival feel intentional.`};
 if(k==='two-five')return {title:'Start a 2–5–1',hint:'Move by fourths',text:`${from.label} can act as the 2 chord in ${KEYS[mod(from.sector+1)][0]}. Move to ${to.label}, then ${byId[`M${mod(from.sector+1)}`].label}: 2–5–1. The bass travels up a fourth each time. The seventh and third of the upper chords connect smoothly.`};
 if(k==='rootless'){
  const dom=from.type==='dominant'?from:to,dim=from.type==='diminished'?from:to;
  return {title:to.type==='diminished'?'Inside the dominant':'Choose a dominant',hint:'Shared tension · new bass',text:`${dim.label}7 and ${dom.label} connect through dominant-flat-nine harmony. The four notes of this diminished seventh are the upper four notes of ${dom.label}♭9, with its root left out (sometimes spelled differently). Change the bass and hear the same tension point somewhere new.`};
 }
 if(k==='common-tone')return {title:'Keep notes, change color',hint:'Two common tones · a new arrival',text:`${from.label}7 shares two pitch classes with the basic ${to.label} major triad. Keep those voices steady and let the other notes move by step. This common-tone diminished approach is a color connection, rather than the usual leading-tone resolution.`};
 if(k==='symmetry')return {title:'The same four notes',hint:'A new root · the same sound family',text:'A fully diminished seventh is built from equal minor thirds. Move its root up three semitones and you get the same four pitch classes in a new order. The four corners of each inner diamond therefore describe one sound family.'};
 return {title:'Your own connection',hint:'Listen for the voice movement',text:'This movement is outside the highlighted connections in this wheel. It can still work in music. Hear how the voices and bass move, and decide where you want to take it next.'};
}
export function exampleFor(type,sector=0){
 const i=sector;
 if(type==='251')return {ids:[`m${mod(i-1)}`,`V${i}`,`M${i}`],title:'2–5–1',description:'Preparation. Tension. A place to land.',topic:'movements'};
 if(type==='relative')return {ids:[`M${i}`,`v${i}`,`m${i}`],title:'The minor doorway',description:'Let a familiar major chord open into minor.',topic:'movements'};
 return {ids:[`V${i}`,`d${i}`,`d${mod(i+3)}`,`v${mod(i+3)}`,`m${mod(i+3)}`],title:'The diminished doorway',description:'One sound family. A different destination.',topic:'diminished'};
}
const SHARPS=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const FLATS=['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
export function noteName(midi,flat=false){return (flat?FLATS:SHARPS)[mod(midi)];}
export {makeVoicing} from './voicings.js';
