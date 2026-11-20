import {TYPES} from './harmony.js';
import {selectedChord,currentOptions,currentPlan,selectChord} from './app.js';
import {spectrumNodes as all,spectrumByKey, spectrumEdges,SIZE,chordKey,findChords,SPECTRUM,ROOT_ORDER} from './spectrum-model.js';

const NS='http://www.w3.org/2000/svg', $=s=>document.querySelector(s);
const make=(tag,attrs={},text)=>{
  const el=document.createElementNS(NS,tag);
  for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);
  if(text!==undefined)el.textContent=text;
  return el;
};
const old=$('#wheel');old.hidden=true;old.style.display='none';
const svg=make('svg',{id:'universe',viewBox:`0 0 ${SIZE} ${SIZE}`,role:'group','aria-label':'Chord spectrum: 384 permanent chord bubbles. Arrow keys navigate roots and types; Enter plays.'});
old.after(svg);
const defs=make('defs'), marker=make('marker',{id:'spectrum-arrow',viewBox:'0 0 10 10',refX:8,refY:5,markerWidth:10,markerHeight:10,orient:'auto',markerUnits:'userSpaceOnUse'});
marker.append(make('path',{d:'M1 1 L8 5 L1 9',fill:'none',stroke:'context-stroke','stroke-width':2}));defs.append(marker);svg.append(defs);
const lines=make('g',{'aria-hidden':'true',class:'spectrum-lines'}),bubbles=make('g');svg.append(lines,bubbles);
const paths=new Map();
function addPath(source,target){
  const key=`${source.key}>${target.key}`;if(paths.has(key))return paths.get(key);
  const dx=target.x-source.x,dy=target.y-source.y, bend=.08;
  const cx=(source.x+target.x)/2-dy*bend,cy=(source.y+target.y)/2+dx*bend;
  const a=Math.hypot(cx-source.x,cy-source.y),b=Math.hypot(cx-target.x,cy-target.y),r=36;
  const p=make('path',{d:`M${source.x+(cx-source.x)*r/a} ${source.y+(cy-source.y)*r/a} Q${cx} ${cy} ${target.x+(cx-target.x)*r/b} ${target.y+(cy-target.y)*r/b}`,fill:'none',stroke:source.color,'stroke-width':1.1,opacity:.03});
  lines.append(p);const edge={key,source,target,p};paths.set(key,edge);return edge;
}
for(const edge of spectrumEdges)addPath(edge.source,edge.target);
let current=spectrumByKey.get(chordKey(selectedChord())), options=currentOptions(), plan=currentPlan(),showAll=false;
let hovered=null,tabKey=current.key;
let zoom=1,center={x:SIZE/2,y:SIZE/2},suppressClick=false,cameraMode='overview';
function paintPaths(){
  const targetKeys=new Set(options.map(o=>chordKey(o.node)));
  const routeEdges=new Set();
  for(let i=(plan.index||0)+1;i<plan.steps.length;i++)routeEdges.add(`${chordKey(plan.steps[i-1])}>${chordKey(plan.steps[i])}`);
  for(const n of all){
    const active=n.key===current.key, viable=targetKeys.has(n.key),onRoute=plan.steps.slice(plan.index||0).some(c=>chordKey(c)===n.key);
    n.element.classList.toggle('is-selected',active);
    n.element.classList.toggle('is-dimmed',!showAll&&!active&&!viable&&!onRoute);
    n.element.classList.toggle('is-viable',viable);
    n.element.setAttribute('aria-pressed',String(active));
    n.element.setAttribute('tabindex',n.key===tabKey?'0':'-1');
    n.element.setAttribute('aria-label',`${n.chord.label}, ${n.chord.qualityName}${active?', selected':viable?', connected option':onRoute?', resolution path':''}. Play this chord.`);
  }
  for(const edge of paths.values()){
    const active=edge.source===current&&targetKeys.has(edge.target.key),route=routeEdges.has(edge.key);
    const preview=active&&hovered===edge.target.key;
    edge.p.setAttribute('opacity',preview?'1':active?'.95':route?'.65':showAll?'.16':'.025');
    edge.p.setAttribute('stroke-width',preview?5:active?3:route?2.2:1.1);
    edge.p.setAttribute('stroke',preview?'#f5f8e8':edge.source.color);
    edge.p.toggleAttribute('data-active',active);
    if(active||route){edge.p.setAttribute('marker-end','url(#spectrum-arrow)');lines.append(edge.p);}else edge.p.removeAttribute('marker-end');
    if(route&&!active)edge.p.setAttribute('stroke-dasharray','8 7');else edge.p.removeAttribute('stroke-dasharray');
  }
}
function choose(n,{focus=false}={}){
  tabKey=n.key;
  selectChord(n.chord);
  if(focus){focusChord(n);n.element.focus({preventScroll:true});}
}
for(const n of all){
  const g=make('g',{transform:`translate(${n.x} ${n.y})`,role:'button',tabindex:-1,'data-chord-key':n.key,class:'universe-node',style:`--chord-color:${n.color};--chord-hue:${n.hue}`});
  g.append(make('circle',{r:38,class:'spectrum-halo'}),make('circle',{r:33,class:'spectrum-body'}));
  const text=make('text',{'text-anchor':'middle','font-family':'DM Sans,system-ui','font-size':23});
  text.append(make('tspan',{x:0,y:-3},n.chord.rootLabel),make('tspan',{x:0,y:18,'font-size':13},TYPES[n.chord.qualityId].suffix||'major'));
  g.append(text);n.element=g;bubbles.append(g);
  g.addEventListener('click',()=>{if(!suppressClick)choose(n);});
  g.addEventListener('pointerenter',()=>{hovered=n.key;paintPaths();});
  g.addEventListener('pointerleave',()=>{hovered=null;paintPaths();});
  g.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(n);}
    if(['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();let column=n.column,row=n.row;
      if(e.key==='ArrowRight')column=(column+1)%SPECTRUM.length;
      if(e.key==='ArrowLeft')column=(column+SPECTRUM.length-1)%SPECTRUM.length;
      if(e.key==='ArrowUp')row=(row+ROOT_ORDER.length-1)%ROOT_ORDER.length;
      if(e.key==='ArrowDown')row=(row+1)%ROOT_ORDER.length;
      const next=spectrumByKey.get(`${ROOT_ORDER[row]}:${SPECTRUM[column][0]}`);
      tabKey=next.key;paintPaths();focusChord(next);next.element.focus({preventScroll:true});
    }
  });
}
function view(){
  zoom=Math.max(.8,Math.min(10,zoom));
  const size=SIZE/zoom;
  center.x=Math.max(-size/3,Math.min(SIZE+size/3,center.x));
  center.y=Math.max(-size/3,Math.min(SIZE+size/3,center.y));
  svg.setAttribute('viewBox',`${center.x-size/2} ${center.y-size/2} ${size} ${size}`);
  $('#zoom-out').disabled=zoom<=.8;$('#zoom-in').disabled=zoom>=10;
}
function focusChord(n=current){cameraMode='focus';center={x:n.x,y:n.y};const rect=svg.getBoundingClientRect();zoom=Math.max(4,2600/Math.max(1,Math.min(rect.width,rect.height)));view();}
function frameConnections(){
  cameraMode='connections';
  const points=[current,...options.map(o=>spectrumByKey.get(chordKey(o.node))).filter(Boolean)];
  const xs=points.map(n=>n.x),ys=points.map(n=>n.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  center={x:(minX+maxX)/2,y:(minY+maxY)/2};zoom=SIZE/Math.max(440,maxX-minX+200,maxY-minY+200);view();
}
// Account for SVG letterboxing, so panning and pointer-centered zoom agree at
// every screen shape, including inside Faithful Keys' iframe.
function toWorld(clientX,clientY){
  const rect=svg.getBoundingClientRect(),size=SIZE/zoom,scale=Math.min(rect.width,rect.height)/size;
  return {x:center.x+(clientX-rect.left-rect.width/2)/scale,y:center.y+(clientY-rect.top-rect.height/2)/scale};
}
svg.addEventListener('wheel',e=>{
  e.preventDefault();cameraMode='free';const before=toWorld(e.clientX,e.clientY);
  zoom=Math.max(.8,Math.min(10,zoom*Math.exp(-e.deltaY*.0015)));
  const after=toWorld(e.clientX,e.clientY);center.x+=before.x-after.x;center.y+=before.y-after.y;view();
},{passive:false});
const pointers=new Map();let gesture=null;
function resetGesture(){
  const points=[...pointers.values()];
  if(!points.length){gesture=null;return;}
  const mid=points.length>1?{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2}:points[0];
  gesture={mid,center:{...center},zoom,anchor:toWorld(mid.x,mid.y),distance:points.length>1?Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y):0};
}
svg.addEventListener('pointerdown',e=>{
  if(e.button!==0&&e.pointerType==='mouse')return;
  if(!pointers.size)suppressClick=false;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});resetGesture();
});
svg.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId)||!gesture)return;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const points=[...pointers.values()];
  const mid=points.length>1?{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2}:points[0];
  if(points.length>1){
    suppressClick=true;
    const distance=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y);
    zoom=Math.max(.8,Math.min(10,gesture.zoom*distance/Math.max(gesture.distance,1)));
  }else if(Math.hypot(mid.x-gesture.mid.x,mid.y-gesture.mid.y)>6)suppressClick=true;
  if(!suppressClick)return;
  cameraMode='free';
  const under=toWorld(mid.x,mid.y);center.x+=gesture.anchor.x-under.x;center.y+=gesture.anchor.y-under.y;
  svg.setPointerCapture(e.pointerId);svg.classList.add('is-dragging');view();
});
function endPointer(e){pointers.delete(e.pointerId);resetGesture();if(!pointers.size)svg.classList.remove('is-dragging');}
svg.addEventListener('pointerup',endPointer);svg.addEventListener('pointercancel',endPointer);
svg.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId))endPointer(e);});
svg.addEventListener('click',e=>{if(suppressClick){e.stopPropagation();e.preventDefault();suppressClick=false;}},true);
document.addEventListener('spectrum-camera',e=>{
  if(e.detail==='fit'){cameraMode='overview';zoom=1;center={x:SIZE/2,y:SIZE/2};}
  if(e.detail==='in'){cameraMode='free';zoom*=1.45;center={x:current.x,y:current.y};}
  if(e.detail==='out'){cameraMode='free';zoom/=1.45;}
  view();
});
function refresh(detail){
  current=spectrumByKey.get(chordKey(detail.chord));if(!current)return;
  options=detail.options;plan=detail.plan;showAll=detail.all;tabKey=current.key;
  for(const option of options){const target=spectrumByKey.get(chordKey(option.node));if(target&&target!==current)addPath(current,target);}
  paintPaths();
  if(cameraMode==='focus')focusChord();else if(cameraMode==='connections')frameConnections();
  $('#wheel-hint').textContent=`${current.chord.label} selected · lit arrows show next movements`;
}
document.addEventListener('chord-paths-selection',e=>refresh(e.detail));

const navigation=document.createElement('div');navigation.className='spectrum-navigation';
navigation.innerHTML='<div class="chord-search"><label for="find-chord" class="sr-only">Find a chord</label><input id="find-chord" type="search" placeholder="Find a chord…" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="chord-results"><div id="chord-results" role="listbox" aria-label="Matching chords" hidden></div></div><div class="spectrum-frame-buttons"><button id="focus-chord">Focus</button><button id="frame-connections">Connections</button></div>';
$('.wheel-toolbar').after(navigation);
$('#focus-chord').addEventListener('click',()=>focusChord());$('#frame-connections').addEventListener('click',frameConnections);
const input=$('#find-chord'),results=$('#chord-results');let matches=[],resultIndex=0;
function closeSearch(){results.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
function highlightResult(){
  [...results.children].forEach((b,i)=>b.setAttribute('aria-selected',String(i===resultIndex)));
  if(matches.length)input.setAttribute('aria-activedescendant',`chord-result-${resultIndex}`);
}
function pickResult(n){input.value='';closeSearch();choose(n,{focus:true});}
function search(){
  results.replaceChildren();matches=findChords(input.value);resultIndex=0;
  if(!input.value.trim()){closeSearch();return;}
  results.hidden=false;input.setAttribute('aria-expanded','true');
  if(!matches.length){const empty=document.createElement('div');empty.className='search-empty';empty.textContent='Try Cmaj9, F#7 or Bbm7.';results.append(empty);input.removeAttribute('aria-activedescendant');return;}
  matches.forEach((n,i)=>{
    const b=document.createElement('button');b.type='button';b.id=`chord-result-${i}`;b.role='option';b.tabIndex=-1;
    const label=document.createElement('strong');label.textContent=n.chord.label;label.style.color=n.color;
    const description=document.createElement('span');description.textContent=n.chord.qualityName;
    b.append(label,description);b.addEventListener('click',()=>pickResult(n));results.append(b);
  });highlightResult();
}
input.addEventListener('input',search);input.addEventListener('focus',()=>{if(input.value.trim())search();});
input.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeSearch();}
  if((e.key==='ArrowDown'||e.key==='ArrowUp')&&matches.length){e.preventDefault();resultIndex=(resultIndex+(e.key==='ArrowDown'?1:matches.length-1))%matches.length;highlightResult();}
  if(e.key==='Enter'&&matches[resultIndex]){e.preventDefault();pickResult(matches[resultIndex]);}
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.chord-search'))closeSearch();});
$('.legend').replaceChildren();
const legend=document.createElement('div');legend.className='spectrum-key';legend.textContent='Major · Augmented · Suspended · Minor · Diminished · Dominant';
const help=document.createElement('button');help.className='tiny-help';help.textContent='?';help.setAttribute('aria-label','Explain the chord spectrum colors');help.addEventListener('click',()=>$('#help-button').click());$('.legend').append(legend,help);
$('#chord-type').closest('label').hidden=true;$('#chord-type').closest('label').style.display='none';
refresh({chord:selectedChord(),options:currentOptions(),plan:currentPlan(),all:false});view();
