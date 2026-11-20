import {nodes,byId,optionsFor,relationCopy,mod,noteName} from './theory.js';

// Chord symbols are selectable harmonies, separate from their piano voicing.
// Every explicit symbol preserves its defining pitch classes in both modes.
const type=(id,name,suffix,intervals,family,kind=family,anchor=family)=>({id,name,suffix,intervals,family,kind,type:kind,anchor});
export const CHORD_TYPES=[
 type('M','Major','',[0,4,7],'major'),
 type('maj7','Major 7','maj7',[0,4,7,11],'major'),
 type('maj9','Major 9','maj9',[0,4,7,11,14],'major'),
 type('6','Major 6','6',[0,4,7,9],'major'),
 type('69','Major 6/9','6/9',[0,4,7,9,14],'major'),
 type('add9','Add 9','add9',[0,4,7,14],'major'),
 type('m','Minor','m',[0,3,7],'minor'),
 type('m7','Minor 7','m7',[0,3,7,10],'minor'),
 type('m9','Minor 9','m9',[0,3,7,10,14],'minor'),
 type('m11','Minor 11','m11',[0,3,7,10,14,17],'minor'),
 type('m6','Minor 6','m6',[0,3,7,9],'minor'),
 type('m69','Minor 6/9','m6/9',[0,3,7,9,14],'minor'),
 type('mMaj7','Minor / major 7','mMaj7',[0,3,7,11],'minor'),
 type('7','Dominant 7','7',[0,4,7,10],'dominant'),
 type('9','Dominant 9','9',[0,4,7,10,14],'dominant'),
 type('13','Dominant 13','13',[0,4,7,10,14,21],'dominant'),
 type('7b9','Dominant 7 flat 9','7♭9',[0,4,7,10,13],'dominant'),
 type('7s9','Dominant 7 sharp 9','7♯9',[0,4,7,10,15],'dominant'),
 type('7s5','Dominant 7 sharp 5','7♯5',[0,4,8,10],'dominant'),
 type('7b13','Dominant 7 flat 13','7♭13',[0,4,10,14,20],'dominant'),
 type('13b9','Dominant 13 flat 9','13♭9',[0,4,10,13,21],'dominant'),
 type('alt','Altered dominant','7alt',[0,4,10,13,20],'dominant'),
 type('sus2','Suspended 2','sus2',[0,2,7],'major','suspended','major'),
 type('sus4','Suspended 4','sus4',[0,5,7],'major','suspended','major'),
 type('7sus4','Dominant 7 suspended','7sus4',[0,5,7,10],'dominant','dominant-suspended','dominant'),
 type('9sus4','Dominant 9 suspended','9sus4',[0,5,7,10,14],'dominant','dominant-suspended','dominant'),
 type('13sus4','Dominant 13 suspended','13sus4',[0,5,10,14,21],'dominant','dominant-suspended','dominant'),
 type('dim','Diminished triad','°',[0,3,6],'diminished'),
 type('dim7','Diminished 7','°7',[0,3,6,9],'diminished'),
 type('half','Half-diminished / minor 7 flat 5','m7♭5',[0,3,6,10],'diminished','half-diminished','diminished'),
 type('aug','Augmented','+',[0,4,8],'major','augmented','major'),
 type('augMaj7','Augmented major 7','maj7♯5',[0,4,8,11],'major','augmented','major')
];
export const TYPES=Object.fromEntries(CHORD_TYPES.map(t=>[t.id,t]));
export const defaultQuality=n=>({major:'M',minor:'m',dominant:'7',diminished:'dim7'}[n.type]);
export function chordFor(base,quality=defaultQuality(base),exact=true){
 const q=TYPES[quality]||TYPES[defaultQuality(base)];
 const rootLabel=base.label.match(/^[A-G](?:♯|♭)?/)[0];
 return {...base,rootLabel,label:rootLabel+q.suffix,type:q.type,family:q.family,qualityId:q.id,qualityName:q.name,intervals:q.intervals,exact};
}
export function lookupChord(pc,quality,preferredId=null){
 const q=TYPES[quality];if(!q)throw new Error('Unknown chord type');pc=mod(pc);
 const preferred=byId[preferredId];
 const base=preferred?.pc===pc&&preferred.type===q.anchor?preferred:(q.anchor==='dominant'?nodes.find(n=>n.pc===pc&&n.id[0]==='V'):null)||nodes.find(n=>n.pc===pc&&n.type===q.anchor);
 if(!base)throw new Error('Chord root is missing from the wheel');
 return chordFor(base,quality);
}
export const chordSignature=n=>n.qualityId==='dim7'?`dim7:${mod(n.pc,3)}`:`${n.pc}:${n.qualityId||defaultQuality(n)}`;
export const encodeChord=n=>`${n.id}~${n.qualityId}~${n.exact?1:0}`;
export function decodeChord(input){
 if(input&&typeof input==='object')return input;
 const [id,q,exact]=String(input).split('~');if(!byId[id])return null;
 return chordFor(byId[id],q||defaultQuality(byId[id]),q?exact!=='0':false);
}
export function equivalentAnchor(base,chord){
 if(base.id===chord.id)return true;
 if(chord.qualityId==='dim7')return base.type==='diminished'&&mod(base.pc,3)===mod(chord.pc,3);
 return base.type===TYPES[chord.qualityId].anchor&&base.pc===chord.pc;
}
function dominant(pc,minor=false){return lookupChord(pc,minor?'7b9':'13',nodes.find(n=>n.pc===mod(pc)&&n.id[0]===(minor?'v':'V'))?.id);}

export function resolutionPlan(chord){
 const c=chord,pc=c.pc;
 let steps,kind,explanation,atRest=false;
 if(c.type==='dominant-suspended'){
  const minor=c.id[0]==='v';
  steps=[c,lookupChord(pc,'7',c.id),lookupChord(pc+5,minor?'m9':'maj9')];kind='suspension-release';
  explanation='Release the suspended fourth into the third, then let the dominant resolve down a fifth to its home chord.';
 }else if(c.type==='suspended'){
  steps=[c,lookupChord(pc,'6')];kind='suspension-release';
  explanation=c.qualityId==='sus2'?'Move the suspended second up to the third. The same root now has a clear major color.':'Let the fourth fall a half step into the major third. The bass stays in place.';
 }else if(c.type==='half-diminished'){
  steps=[c,dominant(pc+5,true),lookupChord(pc+10,'m9')];kind='minor-ii-v';
  explanation='Hear this as the half-diminished 2 chord in minor: 2–5–1. The dominant flat 9 creates the pull toward the minor arrival.';
 }else if(c.type==='augmented'){
  steps=[c,lookupChord(pc,'maj9')];kind='augmented-release';
  explanation='Let the raised fifth fall a half step to the natural fifth. The root and major third can remain in place.';
 }else if(c.type==='diminished'){
  steps=[c,lookupChord(pc+1,'maj9')];kind='leading-tone';
  explanation='Use the named diminished root as a leading tone. Move it up a half step to the new major home. Fully diminished sevenths can also be reinterpreted to reach other keys.';
 }else if(c.type==='dominant'){
  const minor=c.id[0]==='v';steps=[c,lookupChord(pc+5,minor?'m9':'maj9')];kind='dominant-resolution';
  explanation='The dominant root moves down a fifth (or up a fourth). Hear its third lead toward the new home note, and its seventh relax into the next harmony.';
 }else if(c.qualityId==='mMaj7'){
  steps=[c,lookupChord(pc,'m9')];kind='minor-color-release';
  explanation='Lower the major seventh by a half step into the minor seventh, releasing this tense minor color without changing the root.';
 }else if(c.type==='minor'){
  steps=[c,lookupChord(pc+2,'half'),dominant(pc+7,true),lookupChord(pc,'m9')];kind='minor-turnaround';atRest=true;
  explanation='This minor chord can already rest. To hear tension and release, leave it through a minor 2–5–1 and return to the same minor home.';
 }else{
  steps=[c,lookupChord(pc+2,'m9'),dominant(pc+7),lookupChord(pc,'maj9')];kind='major-turnaround';atRest=true;
  explanation='This major chord can already rest. This short 2–5–1 turnaround creates movement and brings you back to the same major home.';
 }
 return {steps,kind,explanation,atRest,goal:steps.at(-1)};
}

export function movementCopy(relation,from,to){
 const kind=relation?.kind;
 const copies={
  'major-turnaround':['Prepare a major 2–5–1','A short way back home','Move from the major home into its minor 2 chord. Follow with the dominant 5 chord, then return to the major home.'],
  'minor-turnaround':['Prepare a minor 2–5–1','Half-diminished preparation','The half-diminished chord is the 2 chord in this minor key. Follow it with the dominant, then return to the minor tonic.'],
  'minor-ii-v':['Minor 2 to 5','Preparation becomes tension','A half-diminished 2 chord moves up a fourth to the dominant. That dominant can then resolve up another fourth into the minor home.'],
  'suspension-release':['Release the suspension','A small move inside the chord','Keep the root steady and let the suspended note move into the third. A dominant suspension can then continue to its tonic.'],
  'augmented-release':['Release the raised fifth','A half-step change of color','Let the augmented fifth descend by a half step to the natural fifth, while the root and third can stay.'],
  'augmented-cadence':['Let the color lead onward','A major arrival up a fourth','The augmented chord can also approach the major chord a fourth above it. Its third and raised fifth can rise by half steps while a common tone stays.'],
  'rootless-triad':['Add a dominant bass','The diminished triad inside V7','This diminished triad supplies the third, fifth and seventh of the dominant. Add the dominant root to hear where the tension can lead.'],
  'minor-color-release':['Soften the minor tension','Major 7 down to minor 7','Move the major seventh down a half step. The root, minor third and fifth belong to both basic harmonies.'],
  'leading-tone':['Resolve up a half step','Leading tone to a major home','The named diminished root leads upward by a half step. Other chord tones can move by step or remain as a color in the arriving chord.'],
  'dominant-resolution':['Resolve to '+(to.type==='minor'?'minor':'major'),'5 → 1 · release','The dominant resolves down a fifth or up a fourth. Its guide tones help point toward the new home chord.']
 };
 if(copies[kind]){const [title,hint,text]=copies[kind];return {title,hint,text:`${from.label} → ${to.label}. ${text}`};}
 if(kind==='rootless'){
  const dom=from.family==='dominant'?from:to,dim=from.family==='diminished'?from:to;
  return {title:to.family==='diminished'?'Inside dominant tension':'Choose a dominant color',hint:'Connect through a dominant ♭9',text:`${dim.label} connects with ${dom.rootLabel||noteName(dom.pc)}7♭9: remove that dominant’s root and the remaining four pitch classes form the diminished seventh family. If you start with a different dominant extension, this move changes its color on the way into that family.`};
 }
 if(kind==='common-tone')return {title:'Keep notes, change color',hint:'Shared notes · a new arrival',text:`The diminished seventh family and the basic ${to.rootLabel} major triad share two pitch classes. Keep shared notes where possible, and let the other voices move by step.`};
 if(kind==='secondary')return {title:'Open a minor doorway',hint:'A dominant for the relative minor',text:`${to.label} is the dominant that leads into ${lookupChord(from.pc+9,'m9').label}, the relative-minor home of ${from.rootLabel} major.`};
 return relationCopy(relation,from,to);
}

export function movementOptions(chord,forcedNext=null){
 const plan=resolutionPlan(chord),next=forcedNext||plan.steps[1],options=[];
 const firstKind=forcedNext?(chord.type==='dominant-suspended'&&chord.pc===next.pc?'suspension-release':chord.type==='half-diminished'?'minor-ii-v':chord.type==='minor'&&next.family==='dominant'&&next.pc===mod(chord.pc+5)?'two-five':chord.family==='dominant'?'dominant-resolution':plan.kind):plan.kind;
 const add=(node,relation,primary=false)=>{if(!options.some(o=>chordSignature(o.node)===chordSignature(node)))options.push({node,relation,primary});};
 add(next,{kind:firstKind},true);
 const base=byId[chord.id];
 const ordinary=chord.type===base.type&&!(chord.type==='diminished'&&chord.qualityId!=='dim7');
 if(ordinary)for(const option of optionsFor(base)){
  const target=option.node;
  let q={major:'maj9',minor:'m9',dominant:'13',diminished:'dim7'}[target.type];
  if(target.type==='dominant'&&['secondary','dominant-minor','rootless'].includes(option.relation.kind))q='7b9';
  add(lookupChord(target.pc,q,target.id),option.relation);
 }
 if(chord.type==='half-diminished')add(lookupChord(chord.pc+1,'maj9'),{kind:'leading-tone'});
 if(chord.type==='suspended')add(lookupChord(chord.pc,'m7'),{kind:'suspension-release'});
 if(chord.type==='dominant-suspended'){
  add(lookupChord(chord.pc+5,'maj9'),{kind:'dominant-resolution'});
  add(lookupChord(chord.pc+5,'m9'),{kind:'dominant-resolution'});
 }
 if(chord.type==='augmented')add(lookupChord(chord.pc+5,'6'),{kind:'augmented-cadence'});
 if(chord.qualityId==='dim')add(dominant(chord.pc-4),{kind:'rootless-triad'});
 return options;
}
