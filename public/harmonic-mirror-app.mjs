
import {NOTE_NAMES,KEY_NAMES,scalePcs,sharedKeys,recognizeChord,voiceLeading,chordStructure,pitchGeometry,intervalRays} from './harmonic-mirror-engine.mjs';

const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
const held=new Map(),sustained=new Map(),pedals=new Map();
let home=0,mode='major',currentView='shape',comparedKey=7,midiAccess=null;
let previousChord=[],latestChord=[],lastMovement=null,stableTimer=null,discoveryTimer=null,lastInsight='';
let demoRunning=false,demoTimers=[],demoIndex=0,audioContext=null;
const demoChords=[
 {notes:[48,52,55]},             // C
 {notes:[48,52,55,59]},          // Cmaj7
 {notes:[48,52,55,59,62]},       // Cmaj9
 {notes:[48,51,54,57]},          // Cdim7
 {notes:[48,50,52,54,56,58]},    // whole-tone tones
 {notes:[43,53,59,62]},          // G7
 {notes:[48,52,55,59]}           // Cmaj7 resolution
];
const mod=n=>(n%12+12)%12;
const midiDisplay=n=>NOTE_NAMES[mod(n)]+(Math.floor(n/12)-1);
const svg=(tag,attrs={},text)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;return e;};
const center={x:330,y:231},radius=166;
const polar=(pc,r=radius,c=center)=>{const angle=(mod(pc)*30-90)*Math.PI/180;return {x:c.x+r*Math.cos(angle),y:c.y+r*Math.sin(angle)};};
const svgElement=$('diagram');
const VIEW_CONFIG={
 shape:{title:'Chords',lead:'Play a chord to identify its name, notes, and extensions.',caption:'Each active point is a note you are playing. Multiple octaves of the same note are combined in this view.'},
 intervals:{title:'Chord Intervals',lead:'See the intervals from the chord root to the other notes.',caption:'Numbers show semitones above the chord root, regardless of the octave played.'},
 motion:{title:'Voice Movement',lead:'Compare the previous chord with the current chord to see which notes stayed or changed.',caption:'Movements use actual MIDI notes and octaves; closest-note matches are estimates.'},
 keys:{title:'Key Relationships',lead:'Select a key to hear how your current chord can function in a different tonal center.',caption:'Shared scale notes suggest related keys but do not establish a modulation.'}
};
function push(tag,attrs={},text,parent=svgElement){const n=svg(tag,attrs,text);parent.appendChild(n);return n;}
function heading(text){push('text',{x:330,y:225,'text-anchor':'middle',fill:'#f4fafc','font-size':19,'font-weight':800},text);}
function subheading(text){push('text',{x:330,y:246,'text-anchor':'middle',fill:'#a6bdc8','font-size':11},text);}
function drawBaseRing(){
 push('circle',{cx:center.x,cy:center.y,r:radius,class:'ring'});
 push('circle',{cx:center.x,cy:center.y,r:112,class:'ring-inner'});
}
function point(pc,{root=false,active=false,color=false,core=false,sustain=false,label=true}={}){
 const p=polar(pc);
 let cls='point'+(scalePcs(home,mode).includes(pc)?' key-member':'');
 if(active)cls+=' active';
 if(root)cls+=' root';else if(color)cls+=' color';else if(core)cls+=' core';
 if(sustain)cls+=' sustained';
 push('circle',{cx:p.x,cy:p.y,r:active?19:15,class:cls});
 if(label)push('text',{x:p.x,y:p.y+4,'text-anchor':'middle',class:'pitch-text'+(active?' active':'')+(root?' root':'')},NOTE_NAMES[pc]);
 return p;
}
function currentEntries(){
 const pitches=new Map();
 for(const item of sustained.values())pitches.set(item.note,{note:item.note,velocity:item.velocity,sustain:true});
 for(const item of held.values()){
  const p=pitches.get(item.note);
  pitches.set(item.note,{note:item.note,velocity:Math.max(item.velocity,p?.velocity||0),sustain:false});
 }
 return [...pitches.values()].sort((a,b)=>a.note-b.note);
}
function chordText(chord){
 if(chord.kind==='empty')return '—';
 if(chord.kind==='interval')return '—';
 if(chord.kind==='cluster')return 'Chord not identified';
 return chord.label;
}
function drawChordShape(entries,analysis,structure){
 drawBaseRing();
 const geom=pitchGeometry(entries.map(x=>x.note));
 if(geom.count>=3){
  const points=geom.pcs.map(pc=>{const p=polar(pc);return p.x+','+p.y;}).join(' ');
  push('polygon',{points,class:'shape-fill'});
 }else if(geom.count===2){
  const a=polar(geom.pcs[0]),b=polar(geom.pcs[1]);
  push('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'shape-line'});
 }
 const roles=new Map(structure.roles.map(x=>[x.pc,x]));
 const pedalPcs=new Set(geom.pcs.filter(pc=>entries.filter(x=>mod(x.note)===pc).every(x=>x.sustain)));
 for(let pc=0;pc<12;pc++){
  const role=roles.get(pc),active=geom.pcs.includes(pc),root=role?.kind==='root';
  const p=point(pc,{active,root,core:role?.kind==='core',color:role?.kind==='color',sustain:pedalPcs.has(pc)});
  if(role)push('text',{x:p.x,y:p.y+32,'text-anchor':'middle',class:'degree-text'},role.degree);
 }
 push('circle',{cx:center.x,cy:center.y,r:54,class:'center-disk'});
 heading(chordText(analysis));
 subheading(analysis.kind==='chord'?'':geom.count?'PLAY A CHORD':'PLAY TO EXPLORE');
 return geom;
}
function drawIntervals(entries,analysis){
 drawBaseRing();
 const shape=pitchGeometry(entries.map(x=>x.note));
 const anchor=analysis.kind==='chord'?analysis.root:null;
 const rays=intervalRays(entries.map(x=>x.note),anchor);
 for(const ray of rays.rays){
  const p=polar(ray.pc);
  push('line',{x1:center.x,y1:center.y,x2:p.x,y2:p.y,class:'ray'});
  const inner=polar(ray.pc,111);
  push('text',{x:inner.x,y:inner.y-6,'text-anchor':'middle',class:'ray-text'},'+'+ray.semitones);
 }
 for(let pc=0;pc<12;pc++){
  point(pc,{active:shape.pcs.includes(pc),root:pc===rays.center&&shape.count>0});
 }
 push('circle',{cx:center.x,cy:center.y,r:39,class:'center-disk'});
 heading(rays.center===null?'—':NOTE_NAMES[rays.center]);
 subheading('ANCHOR');
 return rays;
}
function motionPill(x,y,n,cssClass=''){
 push('rect',{x:x-46,y:y-15,width:92,height:30,rx:10,class:'motion-pill '+cssClass});
 push('text',{x,y:y+4,'text-anchor':'middle',class:'motion-label'},midiDisplay(n));
}
function drawMotion(){
 push('text',{x:134,y:38,'text-anchor':'middle',fill:'#a6bdc8','font-size':11,'font-weight':800},'PREVIOUS');
 push('text',{x:525,y:38,'text-anchor':'middle',fill:'#a6bdc8','font-size':11,'font-weight':800},'CURRENT');
 if(!previousChord.length||!latestChord.length||!lastMovement){
  push('text',{x:330,y:210,'text-anchor':'middle',fill:'#e6f6f8','font-size':18},'Play two chords');
  push('text',{x:330,y:238,'text-anchor':'middle',fill:'#a6bdc8','font-size':12},'The voice movement will appear here.');
  return;
 }
 const unique=[...new Set([...previousChord,...latestChord])].sort((a,b)=>a-b);
 const visible=unique.length<=16?unique:unique.slice(0,16);
 const yFor=n=>75+(visible.indexOf(n))*(unique.length>12?20:Math.min(31,318/Math.max(1,visible.length-1)));
 const oldShown=previousChord.filter(n=>visible.includes(n)),newShown=latestChord.filter(n=>visible.includes(n));
 for(const n of lastMovement.held){
  if(!visible.includes(n))continue;
  const y=yFor(n);push('path',{d:'M 183 '+y+' L 477 '+y,class:'motion-line held'});
 }
 for(const step of lastMovement.moved){
  if(!visible.includes(step.from)||!visible.includes(step.to))continue;
  const ay=yFor(step.from),by=yFor(step.to);
  push('path',{d:'M 183 '+ay+' C 305 '+ay+', 355 '+by+', 477 '+by,class:'motion-line'});
  push('text',{x:333,y:(ay+by)/2-8,'text-anchor':'middle',class:'motion-caption'},(step.delta>0?'+':'')+step.delta+' st');
 }
 for(const n of oldShown)motionPill(134,yFor(n),n,lastMovement.held.includes(n)?'held':'moved');
 for(const n of newShown)motionPill(525,yFor(n),n,lastMovement.held.includes(n)?'held':'moved');
 if(unique.length>16)push('text',{x:330,y:444,'text-anchor':'middle',class:'motion-caption'},'Showing 16 of '+unique.length+' pitches');
}
function drawKeys(){
 drawBaseRing();
 const ordered=Array.from({length:12},(_,i)=>mod(home+7*i));
 const counts=ordered.map(k=>sharedKeys(home,k,mode).length);
 ordered.forEach((pc,i)=>{
  const p=polar(i);
  let cls='key-node';
  if(pc===home)cls+=' selected';
  else if(pc===comparedKey)cls+=' compare';
  const circle=push('circle',{cx:p.x,cy:p.y,r:23,class:cls,role:'button',tabindex:0,'aria-label':'Compare '+KEY_NAMES[pc]+' '+mode});
  circle.addEventListener('click',()=>{comparedKey=pc;render();});
  circle.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();comparedKey=pc;render();}});
  push('text',{x:p.x,y:p.y,'text-anchor':'middle',class:'key-label'},KEY_NAMES[pc]);
  push('text',{x:p.x,y:p.y+13,'text-anchor':'middle',class:'key-count'},counts[i]+'/7');
 });
 push('circle',{cx:center.x,cy:center.y,r:57,class:'center-disk'});
 heading(KEY_NAMES[home]+' ↔ '+KEY_NAMES[comparedKey]);
 subheading(sharedKeys(home,comparedKey,mode).length+'/7 SHARED');
}
function pill(role){
 const el=document.createElement('span');el.className='chip '+(role.kind==='root'?'root':role.kind==='color'?'color':'');
 el.textContent=role.degree+' · '+NOTE_NAMES[role.pc];return el;
}
function insightFor(analysis,structure,_geometry){
 if(analysis.kind==='empty')return 'Play a chord to see its name and notes.';
 if(analysis.kind==='note')return 'Play more notes to complete a chord.';
 if(analysis.kind==='interval')return 'Two notes are sounding. Add another note to identify the chord.';
 if(analysis.kind==='cluster')return 'The notes do not match a recognized chord name. Try releasing a note or selecting a home key.';
 let sentence=chordText(analysis)+' contains the notes '+analysis.pcs.map(pc=>NOTE_NAMES[pc]).join(', ')+'. ';

 if(structure.color.length)sentence+='The '+structure.color.map(x=>x.degree).join(' and ')+' add color to the foundation.';
 return sentence;
}
function explanationFor(modeName,analysis,structure,geometry){
 if(modeName==='shape')return {title:'Your chord',text:insightFor(analysis,structure,geometry)};
 if(modeName==='intervals')return {title:'Chord intervals',text:analysis.kind==='chord'?'These are the intervals from '+NOTE_NAMES[analysis.root]+' to each note in '+chordText(analysis)+'. The numbers count semitones regardless of octave.':'The lowest sounding note is used to measure intervals until a chord is recognized.'};
 if(modeName==='motion'){
  if(!lastMovement)return {title:'Movement, not just names',text:'Play a chord, release it, and play another. Compare the exact MIDI notes. Shared pitches stay horizontally connected; moved voices slope up or down.'};
  return {title:'What changed between chords',text:lastMovement.held.length+' notes stayed exactly the same. '+lastMovement.moved.length+' voices were paired as movements. These are nearest-note estimates, not definitive musical voice assignments.'};
 }
 return {title:'The circle of fifths',text:'Each step clockwise moves by a perfect fifth. Comparing '+KEY_NAMES[home]+' and '+KEY_NAMES[comparedKey]+' '+mode+' reveals '+sharedKeys(home,comparedKey,mode).length+' shared scale tones. This shows key similarity; it does not assert modulation.'};
}
function drawDetails(view,analysis,structure,geom){
 const info=explanationFor(view,analysis,structure,geom);
 $('inspectorTitle').textContent=info.title;
 $('inspectorText').textContent=info.text;
 const details=$('featureDetails');details.replaceChildren();
 const row=document.createElement('div');row.className='info-block';
 const h=document.createElement('h3'),chips=document.createElement('div');h.textContent=view==='shape'?'Chord tones':view==='intervals'?'Chord intervals':view==='motion'?'Voice comparison':'Notes shared by these keys';
 chips.className='chips';
 if(view==='shape'){
  for(const role of [...structure.core,...structure.color])chips.appendChild(pill(role));
  if(!structure.roles.length)for(const pc of geom.pcs){const b=document.createElement('span');b.className='chip';b.textContent=NOTE_NAMES[pc];chips.appendChild(b);}
 }else if(view==='intervals'){
  const intervals=intervalRays(analysis.notes,analysis.kind==='chord'?analysis.root:null);
  for(const item of intervals.rays){const b=document.createElement('span');b.className='chip';b.textContent=NOTE_NAMES[item.pc]+' · '+item.semitones+' st';chips.appendChild(b);}
 }else if(view==='motion'&&lastMovement){
  const data=[
   lastMovement.held.length+' unchanged',
   lastMovement.moved.length+' moved',
   lastMovement.added.length+' added',
   lastMovement.released.length+' released'
  ];
  for(const item of data){const b=document.createElement('span');b.className='chip';b.textContent=item;chips.appendChild(b);}
 }else if(view==='keys'){
  const matching=sharedKeys(home,comparedKey,mode);
  for(const pc of matching){const b=document.createElement('span');b.className='chip';b.textContent=NOTE_NAMES[pc];chips.appendChild(b);}
  const select=document.createElement('select');select.className='mini-select';select.setAttribute('aria-label','Key to compare');
  KEY_NAMES.forEach((name,i)=>{const o=document.createElement('option');o.value=i;o.textContent=name+' '+mode;select.appendChild(o);});
  select.value=comparedKey;select.onchange=e=>{comparedKey=Number(e.target.value);render();};
  row.append(h,select,chips);details.appendChild(row);return;
 }
 row.append(h,chips);details.appendChild(row);
}
function render(){
 const entries=currentEntries(),notes=entries.map(x=>x.note);
 const analysis=recognizeChord(notes,home,mode),structure=chordStructure(analysis),geom=pitchGeometry(notes);
 svgElement.replaceChildren();
 $('graphTitle').textContent=VIEW_CONFIG[currentView].title;
 $('graphLead').textContent=VIEW_CONFIG[currentView].lead;
 $('graphCaption').textContent=VIEW_CONFIG[currentView].caption;
 $('mainChord').textContent=chordText(analysis);
 $('mainFunction').textContent=analysis.function;
 $('playedNotes').textContent=notes.length?'Sounding MIDI pitches: '+notes.map(midiDisplay).join(' · '):'No notes sounding';
 $('key').value=String(home);$('mode').value=mode;
 document.querySelectorAll('[data-view]').forEach(el=>{
  const on=el.dataset.view===currentView;el.setAttribute('aria-selected',String(on));el.tabIndex=on?0:-1;
 });
 if(currentView==='shape')drawChordShape(entries,analysis,structure);
 if(currentView==='intervals')drawIntervals(entries,analysis);
 if(currentView==='motion')drawMotion();
 if(currentView==='keys')drawKeys();
 drawDetails(currentView,analysis,structure,geom);
 if(lastInsight && currentView==='shape')$('inspectorText').textContent=lastInsight;
}
function scheduleSnapshot(){
 clearTimeout(stableTimer);clearTimeout(discoveryTimer);
 const notes=currentEntries().map(x=>x.note);
 const analysis=recognizeChord(notes,home,mode);
 if(analysis.kind!=='chord'){lastInsight='';return;}
 lastInsight='';
 stableTimer=setTimeout(()=>{
  const now=currentEntries().map(x=>x.note),actual=recognizeChord(now,home,mode);
  if(actual.kind!=='chord'||(latestChord.length===now.length&&now.every((n,i)=>n===latestChord[i])))return;
  previousChord=latestChord;latestChord=now;
  if(previousChord.length)lastMovement=voiceLeading(previousChord,latestChord);
  if(currentView==='motion')render();
 },155);
 discoveryTimer=setTimeout(()=>{
  const now=currentEntries().map(x=>x.note);
  if(now.length!==notes.length||now.some((n,i)=>n!==notes[i]))return;
  const a=recognizeChord(now,home,mode),dna=chordStructure(a),g=pitchGeometry(now);
  lastInsight=insightFor(a,dna,g);
  if(currentView==='shape')$('inspectorText').textContent=lastInsight;
 },630);
}
function buildUI(){
 KEY_NAMES.forEach((name,i)=>{const o=document.createElement('option');o.value=i;o.textContent=name;$('key').appendChild(o);});
 $('key').onchange=e=>{home=Number(e.target.value);comparedKey=mod(home+7);lastInsight='';render();};
 $('mode').onchange=e=>{mode=e.target.value;lastInsight='';render();};
 document.querySelectorAll('[data-view]').forEach(btn=>{
  btn.addEventListener('click',()=>{currentView=btn.dataset.view;render();});
  btn.addEventListener('keydown',e=>{
   if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
   e.preventDefault();const views=['shape','intervals','motion','keys'];
   currentView=views[mod(views.indexOf(currentView)+(e.key==='ArrowRight'?1:-1)+12)%4];render();
   document.querySelector('[data-view="'+currentView+'"]').focus();
  });
 });
 $('connect').onclick=connectMidi;$('demo').onclick=toggleDemo;
 $('clear').onclick=()=>{
  stopDemo();held.clear();sustained.clear();pedals.clear();
  previousChord=[];latestChord=[];lastMovement=null;lastInsight='';
  clearTimeout(stableTimer);clearTimeout(discoveryTimer);render();
 };
 render();
}

function update(){render();scheduleSnapshot();}
function setDown(source,n,velocity){
 if(!Number.isInteger(n)||n<21||n>108)return;
 const id=source+'/'+n;
 held.set(id,{note:n,velocity});sustained.delete(id);update();
}
function setUp(source,n){
 const id=source+'/'+n;
 const data=held.get(id);
 if(!data)return;
 held.delete(id);
 if(pedals.get(source))sustained.set(id,data);
 else sustained.delete(id);
 update();
}
function sustain(source,on){
 pedals.set(source,on);
 if(!on)for(const id of [...sustained.keys()])if(id.startsWith(source+'/'))sustained.delete(id);
 update();
}
function stopChannel(source){
 for(const id of [...held.keys()])if(id.startsWith(source+'/'))held.delete(id);
 for(const id of [...sustained.keys()])if(id.startsWith(source+'/'))sustained.delete(id);
 pedals.delete(source);update();
}
function onMidi(e,input){
 const data=e.data;if(!data||data.length<2)return;
 const status=data[0]&0xf0,channel=data[0]&15,source=input.id+':'+channel,n=data[1],velocity=data[2]||0;
 if(demoRunning)stopDemo();
 if(status===0x90&&velocity>0)setDown(source,n,velocity);
 else if(status===0x80||(status===0x90&&velocity===0))setUp(source,n);
 else if(status===0xb0&&n===64)sustain(source,velocity>=64);
 else if(status===0xb0&&(n===120||n===123))stopChannel(source);
}
function refreshDevices(){
 if(!midiAccess)return;
 let connected=0;
 midiAccess.inputs.forEach(input=>{
  if(input.state==='connected'){connected++;input.onmidimessage=e=>onMidi(e,input);}
  else input.onmidimessage=null;
 });
 const status=$('midiStatus');status.classList.toggle('live',connected>0);
 $('midiMessage').textContent=connected?connected+' MIDI input'+(connected===1?'':'s')+' connected':'MIDI access ready · connect your keyboard';
 $('connect').textContent=connected?'Refresh MIDI':'Connect MIDI';
}
async function connectMidi(){
 if(!navigator.requestMIDIAccess){$('midiMessage').textContent='Web MIDI unavailable in this browser';$('midiMessage').classList.add('error');return;}
 try{
  stopDemo();$('midiMessage').textContent='Requesting MIDI access…';
  midiAccess=await navigator.requestMIDIAccess({sysex:false});
  midiAccess.onstatechange=()=>{refreshDevices();const activeIds=new Set([...midiAccess.inputs.values()].filter(x=>x.state==='connected').map(x=>x.id));for(const id of [...held.keys()]){const device=id.split(':')[0];if(device!=='demo'&&!activeIds.has(device))held.delete(id);}for(const id of [...sustained.keys()]){const device=id.split(':')[0];if(device!=='demo'&&!activeIds.has(device))sustained.delete(id);}update();};
  refreshDevices();
 }catch{$('midiMessage').textContent='MIDI connection blocked or declined';$('midiMessage').classList.add('error');}
}
function synth(notes,length=.7){
 try{
  if(!audioContext)audioContext=new (window.AudioContext||window.webkitAudioContext)();
  if(audioContext.state==='suspended')audioContext.resume();
  const t=audioContext.currentTime;
  notes.forEach(n=>{
   const frequency=440*Math.pow(2,(n-69)/12),osc=audioContext.createOscillator(),gain=audioContext.createGain();
   osc.type='sine';osc.frequency.value=frequency;
   gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(.042/Math.sqrt(notes.length),t+.025);
   gain.gain.setTargetAtTime(.0001,t+length*.68,.13);
   osc.connect(gain).connect(audioContext.destination);osc.start(t);osc.stop(t+length+.5);
  });
 }catch{/* Demo visualization remains available without audio */ }
}
function demoStep(){
 if(!demoRunning)return;
 const chord=demoChords[demoIndex%demoChords.length];demoIndex++;
 const source='demo:0';
 for(const id of [...held.keys()])if(id.startsWith(source+'/'))held.delete(id);
 for(const id of [...sustained.keys()])if(id.startsWith(source+'/'))sustained.delete(id);
 chord.notes.forEach(n=>held.set(source+'/'+n,{note:n,velocity:88}));
 update();synth(chord.notes);
 demoTimers.push(setTimeout(()=>{for(const n of chord.notes)held.delete(source+'/'+n);update();},830));
 if(demoIndex<demoChords.length)demoTimers.push(setTimeout(demoStep,1100));
 else demoTimers.push(setTimeout(stopDemo,1200));
}
function stopDemo(){
 demoRunning=false;demoTimers.forEach(clearTimeout);demoTimers=[];
 for(const id of [...held.keys()])if(id.startsWith('demo:'))held.delete(id);
 for(const id of [...sustained.keys()])if(id.startsWith('demo:'))sustained.delete(id);
 $('demo').textContent='Play demo';$('demo').setAttribute('aria-pressed','false');update();
}
function toggleDemo(){
 if(demoRunning){stopDemo();return;}
 demoRunning=true;demoIndex=0;$('demo').textContent='Stop demo';$('demo').setAttribute('aria-pressed','true');demoStep();
}
window.addEventListener('message',event=>{
 if(event.source!==window.parent||event.origin!==window.location.origin||event.data?.type!=='faithful-keys-midi-bridge')return;
 const connected=event.data.connected===true,source='bridge:0';
 const notes=connected&&Array.isArray(event.data.notes)?event.data.notes:[];
 if(demoRunning&&notes.length)stopDemo();
 for(const id of [...held.keys()])if(id.startsWith(source+'/'))held.delete(id);
 for(const id of [...sustained.keys()])if(id.startsWith(source+'/'))sustained.delete(id);
 for(const entry of notes){
  const note=entry?.note;
  if(!Number.isInteger(note)||note<21||note>108)continue;
  const data={note,velocity:Math.max(1,Math.min(127,Number(entry.velocity)||85))};
  (entry.sustained?sustained:held).set(source+'/'+note,data);
 }
 if(connected){$('midiStatus').classList.add('live');$('midiMessage').classList.remove('error');$('midiMessage').textContent='Connected through Faithful Keys';}
 else if(!midiAccess){$('midiStatus').classList.remove('live');$('midiMessage').textContent='MIDI not connected';}
 update();
});
window.addEventListener('blur',()=>{if(demoRunning)stopDemo();});
buildUI();
