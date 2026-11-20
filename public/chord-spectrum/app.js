import {nodes,byId,edges,KEYS,COLORS,mod,sameHarmony,exampleFor,noteName,makeVoicing} from './theory.js?v=octave-reach';
import {contextualPlan,chordFunction,FUNCTION_LANES,spellInKey,modulationTarget} from './key-map.js?v=modulate';
import {ElectricPiano} from './audio.js?v=teacher-video';
import {VOICING_STYLES} from './voicings.js?v=octave-reach';
import {CHORD_TYPES,TYPES,defaultQuality,chordFor,lookupChord,chordSignature,encodeChord,decodeChord,equivalentAnchor,resolutionPlan,movementOptions,movementCopy} from './harmony.js?v=key-functions';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const STORAGE='chord-paths-v1';
const spectrumMode=document.documentElement.dataset.chordView==='spectrum';
let saved={};try{saved=JSON.parse(localStorage.getItem(STORAGE)||'{}');}catch{}
const setting=(value,fallback,min,max)=>Number.isFinite(Number(value))&&value!==undefined?Math.min(max,Math.max(min,Number(value))):fallback;
const state={selected:byId[saved.selected]?saved.selected:'M0',home:Number.isInteger(saved.home)?mod(saved.home):0,all:false,zoom:1,pan:{x:0,y:0},hover:null,example:'251',route:[],playing:null,playIndex:-1,voicingInfo:null,voicedAt:0,style:VOICING_STYLES[saved.style]?saved.style:'auto',mode:saved.mode==='pure'?'pure':'lush',volume:setting(saved.volume,70,0,100),room:setting(saved.room,25,0,70),tempo:setting(saved.tempo,80,45,140),lastMove:null};
state.quality=TYPES[saved.quality]?saved.quality:defaultQuality(byId[state.selected]);state.exact=spectrumMode||saved.exact===true;state.guide=null;
const piano=new ElectricPiano();
document.addEventListener('chord-teacher-capture-audio',event=>{
 try{event.detail.capture=piano.captureAudio();}
 catch(error){event.detail.error=error;}
});
piano.setVolume(state.volume/100);piano.setRoom(state.room/100);
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({selected:state.selected,quality:state.quality,exact:state.exact,home:state.home,style:state.style,mode:state.mode,volume:state.volume,room:state.room,tempo:state.tempo}));}catch{}}
export function selectedChord(){return spellInKey(chordFor(byId[state.selected],state.quality,state.exact),homeKey());}
export function homeKey(){return KEYS[state.home];}
export function currentPlan(){
 const chord=selectedChord();
 if(state.guide)return state.guide;
 const plan=contextualPlan(chord,homeKey()[1])||resolutionPlan(chord);
 const steps=plan.steps.map(step=>spellInKey(step,homeKey()));
 return {...plan,steps,goal:steps.at(-1),index:0};
}
export function currentOptions(){
 const chord=selectedChord();
 const plan=currentPlan();
 const next=plan.steps[plan.index+1];
 const options=movementOptions(chord,next).map(option=>({...option,node:spellInKey(option.node,homeKey())}));
 if(plan.index===0&&next)options[0].relation={kind:plan.kind};
 return options;
}
function chordAtNode(base,options=currentOptions()){
 const selected=selectedChord();if(base.id===selected.id)return selected;
 if(equivalentAnchor(base,selected))return chordFor(base,selected.qualityId,selected.exact);
 const target=options.find(o=>o.node.id===base.id)||options.find(o=>equivalentAnchor(base,o.node));
 return target?chordFor(base,target.node.qualityId,target.node.exact):chordFor(base,defaultQuality(base),false);
}
function edgeConnects(e,from,to){return (equivalentAnchor(byId[e.a],from)&&equivalentAnchor(byId[e.b],to))||(e.both&&equivalentAnchor(byId[e.b],from)&&equivalentAnchor(byId[e.a],to));}
const ns='http://www.w3.org/2000/svg';
function svgEl(tag,attrs={},text){const el=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;}
function pathGeometry(edge){
 const a=byId[edge.a],b=byId[edge.b],dx=b.x-a.x,dy=b.y-a.y;
 if(a.id===b.id)return `M${a.x+30} ${a.y-14} C${a.x+105} ${a.y-75} ${a.x+105} ${a.y+75} ${a.x+30} ${a.y+14}`;
 let cx=(a.x+b.x)/2-dy*edge.bend,cy=(a.y+b.y)/2+dx*edge.bend;
 if(edge.kind==='common-tone'){cx=560+(cx-560)*1.11;cy=560+(cy-560)*1.11;}
 const da=Math.hypot(cx-a.x,cy-a.y),db=Math.hypot(b.x-cx,b.y-cy),r=39;
 const x1=a.x+(cx-a.x)*r/da,y1=a.y+(cy-a.y)*r/da,x2=b.x+(cx-b.x)*r/db,y2=b.y+(cy-b.y)*r/db;
 return `M${x1.toFixed(2)} ${y1.toFixed(2)} Q${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
const pathElements=new Map(),nodeElements=new Map();
function buildWheel(){
 const svg=$('#wheel');
 const defs=svgEl('defs');
 for(const [id,color]of [['arrow','#768590'],['arrow-active','#c9ed9d'],['arrow-preview','#f2f9d9']]){
  const marker=svgEl('marker',{id,viewBox:'0 0 9 9',refX:8,refY:4.5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse',markerUnits:'userSpaceOnUse'});marker.append(svgEl('path',{d:'M1 1 L8 4.5 L1 8',fill:'none',stroke:color,'stroke-width':1.4,'stroke-linecap':'round','stroke-linejoin':'round'}));defs.append(marker);
 }
 svg.append(defs);
 const guides=svgEl('g',{'aria-hidden':'true'});
 for(const r of [211,341,471])guides.append(svgEl('circle',{cx:560,cy:560,r,class:'guide-ring'}));
 svg.append(guides);
 const pathLayer=svgEl('g',{'aria-hidden':'true'});
 for(const e of edges){const p=svgEl('path',{d:pathGeometry(e),class:'wheel-path','data-edge':e.id,'marker-end':'url(#arrow)'});if(e.both)p.setAttribute('marker-start','url(#arrow)');pathLayer.append(p);pathElements.set(e.id,p);}
 svg.append(pathLayer);svg.append(svgEl('g',{id:'extra-paths','aria-hidden':'true'}));
 const center=svgEl('g',{class:'wheel-center','aria-hidden':'true'});
 center.append(svgEl('rect',{x:496,y:520,width:128,height:80,rx:32,fill:'#0b0f14',opacity:'.97'}));
 center.append(svgEl('text',{x:560,y:547,'text-anchor':'middle',class:'center-small'},'FOLLOW'));
 center.append(svgEl('text',{x:560,y:579,'text-anchor':'middle',class:'center-note',id:'center-chord'},'THE SOUND'));
 svg.append(center);
 const nodeLayer=svgEl('g');
 for(const n of nodes){
  const g=svgEl('g',{class:'chord-node',transform:`translate(${n.x},${n.y})`,style:`--node-color:${COLORS[n.type]}`,tabindex:n.id===state.selected?0:-1,role:'button','data-chord':n.id,'aria-label':`${spokenChord(n)}. Play and show connected movements.`,'aria-pressed':'false'});
  g.append(svgEl('circle',{r:38,class:'node-halo'}),svgEl('circle',{r:32,class:'node-body'}),svgEl('text',{'text-anchor':'middle','dominant-baseline':'central'},n.label),svgEl('circle',{r:39,class:'node-hit'}));
  g.addEventListener('click',()=>selectChord(chordAtNode(n)));
  g.addEventListener('keydown',event=>{
   if(event.key==='Enter'||event.key===' '){event.preventDefault();selectChord(chordAtNode(n));}
   if(['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(event.key)){
    event.preventDefault();const typeOrder=['M','m','V','v','d'];let prefix=n.id[0],sector=n.sector;
    if(event.key==='ArrowRight'||event.key==='ArrowLeft')sector=mod(sector+(event.key==='ArrowRight'?1:-1));
    else{const p=typeOrder.indexOf(prefix);prefix=typeOrder[mod(p+(event.key==='ArrowDown'?1:-1),5)];}
    nodeElements.get(`${prefix}${sector}`)?.focus();
   }
  });
  g.addEventListener('pointerenter',()=>{state.hover=n.id;renderWheel();});g.addEventListener('pointerleave',()=>{state.hover=null;renderWheel();});
  g.addEventListener('focus',()=>{state.hover=n.id;renderWheel();});g.addEventListener('blur',()=>{state.hover=null;renderWheel();});
  nodeLayer.append(g);nodeElements.set(n.id,g);
 }
 svg.append(nodeLayer);
}
function spokenChord(n){return `${n.rootLabel||n.label} ${n.qualityName||n.type}`.replaceAll('♯',' sharp ').replaceAll('♭',' flat ');}
function edgeBetween(e,a,b){return (sameHarmony(byId[e.a],a)&&sameHarmony(byId[e.b],b))||(e.both&&sameHarmony(byId[e.b],a)&&sameHarmony(byId[e.a],b));}
function setNodeLabel(el,chord){
 const text=el.querySelector('text');text.replaceChildren();
 if(chord.label.length>=5){
  text.append(svgEl('tspan',{x:0,y:-9,'font-size':24},chord.rootLabel),svgEl('tspan',{x:0,y:13,'font-size':15},TYPES[chord.qualityId].suffix));
 }else text.textContent=chord.label;
}
function renderWheel(){
 if(spectrumMode)return;
 const selected=selectedChord(),options=currentOptions(),activeEdges=new Set(),destinations=new Set(options.map(o=>o.node.id));
 for(const e of edges){
  const active=options.some(o=>edgeConnects(e,selected,o.node))||(e.kind==='symmetry'&&selected.qualityId==='dim7'&&equivalentAnchor(byId[e.a],selected));
  if(active){activeEdges.add(e.id);if(!equivalentAnchor(byId[e.a],selected))destinations.add(e.a);if(!equivalentAnchor(byId[e.b],selected))destinations.add(e.b);}
 }
 for(const n of nodes){
  const el=nodeElements.get(n.id),same=equivalentAnchor(n,selected),suggested=destinations.has(n.id)&&!same,display=chordAtNode(n,options);
  setNodeLabel(el,display);
  el.classList.toggle('selected',n.id===state.selected);el.classList.toggle('equivalent',same&&n.id!==state.selected);el.classList.toggle('suggested',suggested);el.classList.toggle('dimmed',!state.all&&!same&&!suggested);
  el.setAttribute('aria-pressed',n.id===state.selected?'true':'false');el.setAttribute('tabindex',n.id===state.selected?'0':'-1');
  el.setAttribute('aria-label',`${spokenChord(display)}${n.id===state.selected?', selected':same?', same sound family':suggested?', connected option':''}. Play and explore.`);
 }
 for(const e of edges){
  const el=pathElements.get(e.id),active=activeEdges.has(e.id);
  const preview=state.hover&&active&&options.some(o=>o.node.id===state.hover&&edgeConnects(e,selected,o.node));
  const route=state.route.some((id,j)=>j>0&&edgeBetween(e,byId[state.route[j-1]],byId[id]));
  el.classList.toggle('active',active);el.classList.toggle('preview',!!preview);el.classList.toggle('dimmed',!state.all&&!active&&!route);el.classList.toggle('example-edge',route&&!active);
  const marker=preview?'arrow-preview':active||route?'arrow-active':'arrow';el.setAttribute('marker-end',`url(#${marker})`);if(e.both)el.setAttribute('marker-start',`url(#${marker})`);
  if(active&&e.kind!=='symmetry'){
   const forward=options.some(o=>equivalentAnchor(byId[e.a],selected)&&equivalentAnchor(byId[e.b],o.node));
   const backward=e.both&&options.some(o=>equivalentAnchor(byId[e.b],selected)&&equivalentAnchor(byId[e.a],o.node));
   if(!forward)el.removeAttribute('marker-end');
   if(backward)el.setAttribute('marker-start',`url(#${marker})`);else el.removeAttribute('marker-start');
  }
  if(active)el.parentNode.append(el);
 }
 const extra=$('#extra-paths');extra.replaceChildren();
 for(const option of options){
  if(edges.some(e=>edgeConnects(e,selected,option.node)))continue;
  const path=svgEl('path',{d:pathGeometry({a:selected.id,b:option.node.id,bend:.16,kind:'extra'}),class:'wheel-path active extra-connection','marker-end':'url(#arrow-active)'});
  if(state.hover===option.node.id)path.classList.add('preview');extra.append(path);
 }
 $('#center-chord').textContent=selected.label;$('#center-chord').style.fontSize=selected.label.length>5?'24px':'';
 $('#wheel-hint').textContent=state.all?'Original connections plus the selected chord’s movements':window.matchMedia('(max-width:700px)').matches?'Tap to hear. Use + for a closer look.':'Lit paths show connected choices and a way to resolve.';
}
function renderResolution(){
 const p=currentPlan(),complete=p.index===p.steps.length-1,goal=p.steps.at(-1);
 $('#resolution-status').textContent=complete?'RESOLVED':'A WAY TO RESOLVE';
 $('#resolution-route').replaceChildren();
 p.steps.forEach((chord,i)=>{
  if(i){const dot=document.createElement('span');dot.className='resolution-divider';dot.textContent='·';$('#resolution-route').append(dot);}
  const label=document.createElement('span');label.textContent=chord.label;label.className=i===p.index?'route-current':i<p.index?'route-complete':'';$('#resolution-route').append(label);
 });
 $('#resolution-caption').textContent=complete?`Arrived at ${goal.label}. Let it rest.`:p.atRest&&p.index===0?'Already a resting chord. Explore a turnaround.':`A clear arrival at ${goal.label}.`;
 $('#resolve-next').textContent=complete?'Explore another resolution':`Play next: ${p.steps[p.index+1].label}`;
 $('#resolution-card').classList.toggle('resolved',complete);
}
function advanceResolution(){
 const p=currentPlan();
 if(p.index===p.steps.length-1){state.guide=null;render();return;}
 state.guide=p;p.index++;selectChord(p.steps[p.index],{keepGuide:true});
}
function renderPanel(){
 const n=selectedChord();
 $('#current-chord').textContent=n.label;$('#current-quality').textContent=n.qualityName.toUpperCase();
 const role=chordFunction(n,homeKey()[1]);
 $('#current-function').textContent=role.role+' · '+FUNCTION_LANES[role.column].label+' in '+homeKey()[0];$('#current-chord').style.fontSize=n.label.length>7?'38px':n.label.length>4?'48px':'';$('#chord-type').value=n.qualityId;
 $('#selection-prompt').textContent=state.playing?'Follow the lit path. Listen to the movement.':n.qualityId==='dim7'?'One sound family. More than one way out.':'Choose a lit chord. Follow the sound.';
 $('#connections').replaceChildren();
 for(const o of currentOptions()){
  const copy=movementCopy(o.relation,n,o.node),b=document.createElement('button');b.className='connection-row';b.setAttribute('aria-label',`${o.node.label}: ${copy.title}. Play this movement.`);
  const note=document.createElement('span');note.className='connection-note';note.textContent=o.node.label;
  const text=document.createElement('span');text.className='connection-copy';const title=document.createElement('strong');title.textContent=copy.title;const hint=document.createElement('small');hint.textContent=copy.hint;text.append(title,hint);
  const symbol=document.createElement('span');symbol.className='connection-symbol';symbol.textContent='↗';symbol.setAttribute('aria-hidden','true');b.append(note,text,symbol);
  b.classList.toggle('resolution-option',!!o.primary);b.addEventListener('click',()=>selectChord(o.node));b.addEventListener('pointerenter',()=>{state.hover=o.node.id;renderWheel();});b.addEventListener('pointerleave',()=>{state.hover=null;renderWheel();});b.addEventListener('focus',()=>{state.hover=o.node.id;renderWheel();});b.addEventListener('blur',()=>{state.hover=null;renderWheel();});$('#connections').append(b);
 }
 $('#movement-result').textContent=state.lastMove?.modulated
  ? `New key: ${homeKey()[0]} major.`
  : state.lastMove?.unlinked?'An open connection. Let your ear decide where it goes.':'';
}
function renderExample(){
 const example=exampleFor(state.example,state.home);$('#example-notes').replaceChildren();
 for(const [i,id]of example.ids.entries()){
  if(i){const divider=document.createElement('span');divider.className='route-divider';divider.textContent='·';$('#example-notes').append(divider);}
  const span=document.createElement('span');span.textContent=byId[id].label;$('#example-notes').append(span);
 }
 if(example.ids.length>4)$('#example-notes').style.fontSize='18px';else $('#example-notes').style.fontSize='';
 $('#example-description').textContent=example.description;$('#pathway-key').textContent=KEYS[state.home][0];
 $('#play-example span').textContent=state.playing==='example'?'Stop listening':'Hear this path';
 $$('#pathway-picker button').forEach(b=>b.classList.toggle('active',b.dataset.example===state.example));
}
function render(){renderWheel();renderPanel();renderResolution();renderExample();if(spectrumMode)document.dispatchEvent(new CustomEvent('chord-paths-selection',{detail:{chord:selectedChord(),options:currentOptions(),plan:currentPlan(),all:state.all,home:homeKey()}}));}
let voicingRequest=0;
async function soundChord(id,{revoice=false}={}){
 const request=++voicingRequest;
 const previous=performance.now()-state.voicedAt<10000?state.voicingInfo:null;
 const voicing=makeVoicing(decodeChord(id),previous||[],state.mode,Math.random,{style:state.style,revoice});
 const played=await piano.play(voicing,state.playing?Math.max(.8,120/state.tempo+.25):3.3);
 if(played&&request===voicingRequest){
  state.voicingInfo=voicing;state.voicedAt=performance.now();
  document.dispatchEvent(new CustomEvent('chord-teacher-keys',{detail:{notes:voicing.notes,shared:voicing.kept||[],leftHand:voicing.leftHand,rightHand:voicing.rightHand,label:spellInKey(decodeChord(id),homeKey()).label}}));
 }
 return played;
}
export function selectChord(input,{play=true,internal=false,keepGuide=false}={}){
 const decoded=decodeChord(input);if(!decoded)return;const chord=spectrumMode?{...decoded,exact:true}:decoded;if(!internal)stopSequence(!play);
 const previous=selectedChord(),relation=currentOptions().find(o=>chordSignature(o.node)===chordSignature(chord))?.relation;
 state.lastMove={from:previous.id,to:chord.id,relation,unlinked:!keepGuide&&!relation&&previous.pc!==chord.pc};
 if((internal&&state.playIndex===0)||(!internal&&!play))state.lastMove=null;
 if(!keepGuide)state.guide=null;
 if(play&&!internal){
  const target=modulationTarget(previous,chord,homeKey()[1]);
  if(target!==null){
   state.home=KEYS.findIndex(key=>key[1]===target);
   $('#home-key').value=String(state.home);
   state.lastMove.modulated=true;
   state.lastMove.unlinked=false;
  }
 }
 state.selected=chord.id;state.quality=chord.qualityId;state.exact=chord.exact;state.hover=null;
 render();persist();
 const body=nodeElements.get(chord.id)?.querySelector('.node-body');if(body){body.classList.remove('animated-pulse');requestAnimationFrame(()=>body.classList.add('animated-pulse'));}
 if(play)soundChord(chord);
 else if(!internal){
  voicingRequest++;
  state.voicingInfo=null;
  document.dispatchEvent(new CustomEvent('chord-teacher-keys',{detail:{notes:[],shared:[],label:''}}));
 }
}
document.addEventListener('chord-teacher-audition',async event=>{
 const note=event.detail;
 if(!Number.isInteger(note)||note<33||note>96)return;
 stopSequence(false);
 state.voicingInfo=null;
 render();
 const request=++voicingRequest;
 const played=await piano.play({notes:[note],velocities:[68],offsets:[0],rearticulate:true},1.2);
 if(played&&request===voicingRequest)document.dispatchEvent(new CustomEvent('chord-teacher-keys',{detail:{notes:[note],shared:[],label:''}}));
});
let sequenceToken=0,timer=null,resolveDelay=null;
function stopSequence(silence=true){
 sequenceToken++;if(timer){clearTimeout(timer);timer=null;}if(resolveDelay){resolveDelay();resolveDelay=null;}voicingRequest++;if(silence)piano.stop();else piano.cancelPending();state.playing=null;state.route=[];state.playIndex=-1;
}
async function playSequence(ids,kind){
 if(state.playing===kind){stopSequence();render();return;}
 const chords=ids.map(decodeChord).filter(Boolean);if(!chords.length)return;stopSequence();state.voicingInfo=null;const token=sequenceToken;state.playing=kind;state.route=chords.map(n=>n.id);render();
 try{piano.unlock().catch(()=>{});}catch{}
 for(let i=0;i<chords.length;i++){
  if(token!==sequenceToken)break;
  state.playIndex=i;selectChord(chords[i],{play:false,internal:true});
  const played=await soundChord(chords[i]);if(token!==sequenceToken)break;if(!played){stopSequence();render();return;}
  await new Promise(resolve=>{resolveDelay=resolve;timer=setTimeout(()=>{timer=null;resolveDelay=null;resolve();},120000/state.tempo);});
 }
 if(token===sequenceToken){state.playing=null;state.route=[];state.playIndex=-1;render();}
}
let statusTimer;
piano.addEventListener('status',event=>{
 const {state:status,message}=event.detail;clearTimeout(statusTimer);const el=$('#audio-status');
 if(status==='ready'){$('#sound-dot').classList.add('ready');el.hidden=true;}
 else {el.textContent=message;el.classList.toggle('error',status==='error');el.hidden=false;if(status==='error')statusTimer=setTimeout(()=>el.hidden=true,8000);}
});

const HELP={
 wheel:()=>`<h3>Follow the function in each key</h3><p>Pick a key on the circle of fifths. Every key has the same four lanes: <strong>Prepare</strong> (ii and IV), <strong>Create tension</strong> (V and the leading tone), <strong>Arrive</strong> (I and its neighboring minor colors), and <strong>Change color</strong> (secondary dominants and borrowed chords).</p><p>Start with ii, then choose V and I to hear preparation, tension and release. Roman numerals are relative to the home key. A symbol like V/vi means the dominant of the relative minor.</p><p>Bright arrows show suggested next movements. Dashed arrows show later resolution steps. Search lets you find other chords and play them on the key map. When a cadence lands on a new major tonic, the key switcher follows it.</p><p>With a bubble focused, use the arrow keys to navigate and Enter or Space to play. The Faithful Keys piano shows the voicing you just heard.</p>`,
 movements:()=>{
  const n=selectedChord(),options=currentOptions(),plan=currentPlan();
  return `<h3>What can ${n.label} do next?</h3><div class="help-key">${plan.steps.map(c=>c.label).join(" → ")}</div><p>From ${plan.steps[0].label}: ${plan.explanation}</p><p>The same chord can have more than one job. These names describe the feeling and function of the illuminated choices.</p>`+options.map((o,i)=>{const c=movementCopy(o.relation,n,o.node);return `<details${i===0?' open':''}><summary>${n.label} → ${o.node.label} · ${c.title}</summary><p>${c.text}</p><button class="help-listen" data-hear="${encodeChord(n)},${encodeChord(o.node)}">♫ Hear the movement</button></details>`;}).join('')+`<p class="help-note" style="margin-top:18px">A 2–5–1 means preparation → tension → arrival. In C: Dm → G7 → C. A relative-minor doorway is C → E7 → Am. Numbers describe the function in the destination key.</p>`;
 },
 diminished:()=>`<h3>One sound. Several doorways.</h3><div class="help-key">B°7 · D°7 · E♯°7 · G♯°7<br><span style="font-size:14px;color:#9eb591">The same four pitch classes, in different orders.</span></div><p>A <strong>fully diminished seventh</strong> stacks equal minor thirds. B–D–F–A♭ therefore returns to the same notes when its root moves up three semitones. E♯ is the same piano key as F; G♯ is the same as A♭.</p><p>The reference diagram connects these equivalent roots in an inner diamond. In this larger web, each diminished chord has its own permanent bubble. Its lit paths show the equivalent roots and several ways to resolve.</p><p>Those four notes can also be the upper part of a <strong>dominant ♭9</strong>. B–D–F–A♭ is G7♭9 without G, and E7♭9 without E (spelling A♭ as G♯). A different bass gives that shared tension a different destination.</p><button class="help-listen" data-hear="V0,d0,d3,v3,m3">♫ Hear a diminished doorway</button><p class="help-note">° is a diminished triad; °7 is a fully diminished seventh. Only °7 has this four-way symmetry. Half-diminished m7♭5 has a different seventh and commonly begins a minor 2–5–1. Common-tone diminished movements keep shared notes and move the others by step.</p>`,
 voicings:()=>{
  const v=state.voicingInfo,flat=KEYS[state.home][0].includes('♭');
  const heard=v?`<div class="help-key">${v.label} · ${VOICING_STYLES[v.family]||'Pure voicing'}<br><span style="font-size:13px;color:#9eb591">Bass: ${noteName(v.notes[0],flat)} · Upper voices: ${v.notes.slice(1).map(n=>noteName(n,flat)).join(' · ')}</span></div>`:'<p>Tap a chord, then come back here to see the sound you just heard.</p>';
  return `<h3>Give each chord room to sing.</h3>${heard}<p>An explicitly selected chord type keeps the tones named by its symbol. Each hand stays within one octave. Gospel mode may split a voicing between the hands or choose a closer shape when the requested spread cannot fit. Every bubble keeps its named harmony; choose an extended chord’s own bubble to add 6th, 9th, 11th or 13th colors.</p><details open><summary>Drop 2</summary><p>Take a close upper voicing and lower its second-highest voice by one octave. The melody stays on top while space opens underneath it.</p></details><details><summary>Drop 2 & 4</summary><p>Lower the second and fourth voices from the top by an octave. This opens the chord across a wider range and gives both hands something to hold.</p></details><details><summary>Gospel spreads & rootless colors</summary><p>Spreads put more room between the lower voices. Rootless upper structures leave the root to the separate bass, freeing the hands for thirds, sevenths and extensions. Stacks of fourths add a warm 6/9 or minor-11 color.</p></details><details><summary>How one chord connects to the next</summary><p>The app compares possible voicings before choosing. It favors common notes in the same register, a nearby melody note, clear bass spacing, and the third and seventh resolving naturally. It can let a shared sample ring across a quick chord change. The new-voicing button asks for a different grip without changing the harmony.</p></details><p class="help-note">Choose a voicing approach in the sound settings, or let Musical mix find one that connects well. Pure keeps the selected symbol’s chord tones. Explicit chord types keep their named pitches in Gospel mode too. The separate bass keeps the named root present even when the upper structure is rootless.</p>`;
 }
};
export function openHelp(topic='wheel'){
 $$('.help-tabs button').forEach(b=>b.setAttribute('aria-selected',b.dataset.topic===topic?'true':'false'));
 $('#help-content').innerHTML=HELP[topic]();$('#help-content').setAttribute('aria-labelledby','tab-'+topic);
 $$('#help-content [data-hear]').forEach(b=>b.addEventListener('click',()=>playSequence(b.dataset.hear.split(','),'help')));
 if(!$('#help-dialog').open)$('#help-dialog').showModal();
}
function openExampleHelp(){
 const ex=exampleFor(state.example,state.home),n=ex.ids.map(id=>byId[id]);
 let html=`<h3>${ex.title} in ${KEYS[state.home][0]}</h3><div class="help-key">${n.map(x=>x.label).join(' → ')}</div>`;
 if(state.example==='251')html+=`<p><strong>${n[0].label}: prepare.</strong> This is the minor 2 chord in ${n[2].label}. It starts a familiar move toward home.</p><p><strong>${n[1].label}: create tension.</strong> The dominant 5 chord wants to resolve. Listen to its third and seventh pull toward notes in the next chord.</p><p><strong>${n[2].label}: arrive.</strong> The major 1 chord releases the tension. These three chords can form a complete little musical sentence.</p>`;
 else if(state.example==='relative')html+=`<p><strong>${n[0].label}: begin in major.</strong> Its relative minor is ${n[2].label}; the two basic triads share two notes.</p><p><strong>${n[1].label}: open the door.</strong> It is the dominant of ${n[2].label}. Its raised leading tone makes the minor destination feel intentional.</p><p><strong>${n[2].label}: land in minor.</strong> You have heard how a secondary dominant changes the direction of a familiar chord.</p>`;
 else html+=`<p><strong>${n[0].label} to ${n[1].label}7:</strong> hear the dominant’s rootless ♭9 color.</p><p><strong>${n[1].label}7 to ${n[2].label}7:</strong> move between equivalent diminished roots. The upper pitch-class set stays the same, while the bass and voicing can change.</p><p><strong>${n[3].label} to ${n[4].label}:</strong> the same diminished sound supports a different dominant ♭9, then resolves to a new minor home. This is why the diminished family is a useful doorway between keys.</p><p class="help-note">This listening example uses fully diminished sevenths (°7).</p>`;
 html+=`<button class="help-listen" data-hear="${ex.ids.join(',')}">♫ Hear the whole path</button>`;
 if(!$('#help-dialog').open)$('#help-dialog').showModal();$$('.help-tabs button').forEach(b=>b.setAttribute('aria-selected','false'));$('#help-content').innerHTML=html;$('#help-content').setAttribute('aria-label',ex.title);$('#help-content [data-hear]').addEventListener('click',()=>playSequence(ex.ids,'help'));
}

KEYS.forEach((key,i)=>{const option=document.createElement('option');option.value=i;option.textContent=key[0];$('#home-key').append(option);});$('#home-key').value=state.home;
export function setHomeKey(index){
 if(!Number.isInteger(index)||!KEYS[index])return;
 state.home=index;
 $('#home-key').value=String(index);
 selectChord('M'+state.home,{play:false});
}
$('#home-key').addEventListener('change',event=>setHomeKey(Number(event.target.value)));
$('#all-paths').addEventListener('click',()=>{state.all=!state.all;$('#all-paths').setAttribute('aria-pressed',state.all);if(spectrumMode)render();else renderWheel();});
$('#help-button').addEventListener('click',()=>openHelp());$('#movement-help').addEventListener('click',()=>openHelp('movements'));
$$('.help-tabs button').forEach(b=>b.addEventListener('click',()=>openHelp(b.dataset.topic)));
$('#example-help').addEventListener('click',openExampleHelp);
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>$('#'+b.dataset.close).close()));
$$('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}}));
$('#help-dialog').addEventListener('close',()=>{if(state.playing==='help'){stopSequence();render();}});
$('#sound-settings').addEventListener('click',()=>$('#sound-dialog').showModal());
$('#revoice').addEventListener('click',()=>{stopSequence(false);render();soundChord(selectedChord(),{revoice:true});});
$('#play-example').addEventListener('click',()=>playSequence(exampleFor(state.example,state.home).ids,'example'));
$$('#pathway-picker button').forEach(b=>b.addEventListener('click',()=>{stopSequence();state.example=b.dataset.example;state.route=exampleFor(state.example,state.home).ids;render();}));
for(const name of ['volume','room','tempo']){
 $('#'+name).value=state[name];$('#'+name+'-value').value=state[name]+(name==='tempo'?' BPM':'%');
 $('#'+name).addEventListener('input',event=>{state[name]=Number(event.target.value);$('#'+name+'-value').value=state[name]+(name==='tempo'?' BPM':'%');if(name==='volume')piano.setVolume(state.volume/100);if(name==='room')piano.setRoom(state.room/100);persist();});
}
function renderMode(){$$('#voicing-mode button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.color===state.mode));$('#voicing-style').disabled=state.mode==='pure';}renderMode();
$$('#voicing-mode button').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.color;renderMode();persist();}));
for(const [value,label] of Object.entries(VOICING_STYLES)){const option=document.createElement('option');option.value=value;option.textContent=label;$('#voicing-style').append(option);}$('#voicing-style').value=state.style;
$('#voicing-style').addEventListener('change',event=>{state.style=event.target.value;persist();});
const groups=new Map();
for(const q of CHORD_TYPES){
 const name=q.type.includes('suspended')?'Suspended':q.type==='augmented'?'Augmented':q.family[0].toUpperCase()+q.family.slice(1);
 if(!groups.has(name)){const group=document.createElement('optgroup');group.label=name;groups.set(name,group);$('#chord-type').append(group);}
 const option=document.createElement('option');option.value=q.id;option.textContent=q.name;groups.get(name).append(option);
}
$('#chord-type').addEventListener('change',event=>{selectChord(lookupChord(selectedChord().pc,event.target.value,state.selected));});
$('#resolve-next').addEventListener('click',advanceResolution);
$('#resolution-help').addEventListener('click',()=>openHelp('movements'));
$('#stop-audio').addEventListener('click',()=>{stopSequence();render();});
function setZoom(zoom){const previous=state.zoom;state.zoom=Math.min(2.7,Math.max(1,zoom));if(state.zoom===1)state.pan={x:0,y:0};else if(state.zoom>previous){const n=byId[state.selected];state.pan={x:(n.x-560)*.62,y:(n.y-560)*.62};}updateViewBox();}
function updateViewBox(){const size=1120/state.zoom,max=560-size/2;state.pan.x=Math.max(-max,Math.min(max,state.pan.x));state.pan.y=Math.max(-max,Math.min(max,state.pan.y));$('#wheel').setAttribute('viewBox',`${560-size/2+state.pan.x} ${560-size/2+state.pan.y} ${size} ${size}`);$('#wheel-viewport').classList.toggle('is-zoomed',state.zoom>1);$('#zoom-out').disabled=state.zoom===1;$('#zoom-in').disabled=state.zoom>=2.7;}
for(const [id,action]of [['zoom-in','in'],['zoom-out','out'],['fit','fit']])$('#'+id).addEventListener('click',()=>{if(spectrumMode)document.dispatchEvent(new CustomEvent('spectrum-camera',{detail:action}));else setZoom(action==='in'?state.zoom+.35:action==='out'?state.zoom-.35:1);});
let drag=null,dragged=false;
$('#wheel-viewport').addEventListener('pointerdown',event=>{if(state.zoom<=1)return;drag={x:event.clientX,y:event.clientY,pan:{...state.pan},id:event.pointerId};dragged=false;});
$('#wheel-viewport').addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>7)dragged=true;if(dragged){$('#wheel-viewport').setPointerCapture(event.pointerId);const factor=1120/state.zoom/$('#wheel').getBoundingClientRect().width;state.pan={x:drag.pan.x-dx*factor,y:drag.pan.y-dy*factor};updateViewBox();}});
$('#wheel-viewport').addEventListener('pointerup',()=>{drag=null;});$('#wheel-viewport').addEventListener('pointercancel',()=>{drag=null;});$('#wheel-viewport').addEventListener('click',event=>{if(dragged){event.stopPropagation();dragged=false;}},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){stopSequence();render();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopSequence();render();}});
if(!spectrumMode){buildWheel();updateViewBox();}render();persist();
