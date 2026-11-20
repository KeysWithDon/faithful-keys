import {FUNCTION_LANES,coreChords,chordFunction,spellInKey} from './key-map.js';
import {TYPES} from './harmony.js?v=key-functions';
import {selectedChord,currentOptions,currentPlan,selectChord,homeKey,setHomeKey} from './app.js?v=octave-reach';
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
const laneLayer=make('g',{'aria-hidden':'true',class:'function-lanes'});
svg.append(laneLayer);
const radialPositions=new Map(all.map(n=>[n.key,{x:n.x,y:n.y}]));
const lines=make('g',{'aria-hidden':'true',class:'spectrum-lines'}),bubbles=make('g');svg.append(lines,bubbles);
const paths=new Map();
function addPath(source,target){
  const key=`${source.key}>${target.key}`;if(paths.has(key))return paths.get(key);
  const p=make('path',{fill:'none',stroke:source.color,'stroke-width':1.1,opacity:.03});
  lines.append(p);
  const edge={key,source,target,p};
  paths.set(key,edge);
  return edge;
}

function positionPath({source,target,p}){
  const dx=target.x-source.x,dy=target.y-source.y;
  const cx=(source.x+target.x)/2-dy*.08,cy=(source.y+target.y)/2+dx*.08;
  const a=Math.hypot(cx-source.x,cy-source.y),b=Math.hypot(cx-target.x,cy-target.y),r=36;
  p.setAttribute('d',`M${source.x+(cx-source.x)*r/a} ${source.y+(cy-source.y)*r/a} Q${cx} ${cy} ${target.x+(cx-target.x)*r/b} ${target.y+(cy-target.y)*r/b}`);
}
for(const edge of spectrumEdges)addPath(edge.source,edge.target);
let current=spectrumByKey.get(chordKey(selectedChord())), options=currentOptions(), plan=currentPlan(),showAll=false;
let hovered=null,tabKey=current.key;
let zoom=1,center={x:SIZE/2,y:SIZE/2},suppressClick=false,cameraMode='overview';
let mapMode='keys';
let layoutWidth=SIZE,layoutHeight=SIZE;
let visibleKeys=new Set();
let layoutSignature='';

function layoutKeyMap(){
  const tonic=homeKey()[1];
  const core=coreChords(tonic);
  const keys=new Set([...core.map(n=>n.key),current.key,...options.map(o=>chordKey(o.node)),...plan.steps.slice(plan.index).map(chordKey)]);
  const compact=svg.clientWidth<650;
  const signature=[mapMode,tonic,compact,...keys].join('|');
  if(signature===layoutSignature)return false;
  layoutSignature=signature;
  laneLayer.replaceChildren();
  if(mapMode==='spectrum'){
    layoutWidth=layoutHeight=SIZE;
    visibleKeys=new Set(all.map(n=>n.key));
    for(const n of all)Object.assign(n,radialPositions.get(n.key));
  }else{
    visibleKeys=keys;
    const columns=compact?2:4;
    const laneWidth=280;
    const groups=FUNCTION_LANES.map(()=>[]);
    for(const key of keys){
      const n=spectrumByKey.get(key);
      if(!n)continue;
      const role=chordFunction(n.chord,tonic,core);
      groups[role.column].push({n,role});
    }
    layoutWidth=columns*laneWidth+20;
    let top=12;
    for(let start=0;start<groups.length;start+=columns){
      const row=groups.slice(start,start+columns);
      const height=68+Math.max(...row.map(group=>Math.ceil(group.length/3)))*107;
      row.forEach((group,index)=>{
        const lane=FUNCTION_LANES[start+index],left=10+index*laneWidth;
        laneLayer.append(
          make('rect',{x:left+4,y:top,width:laneWidth-8,height:height-9,rx:12,fill:lane.color,'fill-opacity':.055,stroke:lane.color,'stroke-opacity':.25}),
          make('text',{x:left+17,y:top+30,fill:lane.color,class:'function-lane-label'},lane.label),
          make('text',{x:left+17,y:top+52,fill:'#a6b2bf',class:'function-lane-hint'},lane.description)
        );
        group.forEach(({n,role},slot)=>{
          n.x=left+52+88*(slot%3);
          n.y=top+107+107*Math.floor(slot/3);
          n.roleElement.textContent=role.role.split(' · ')[0];
        });
      });
      top+=height;
    }
    layoutHeight=top+6;
  }
  for(const n of all){
    n.displayChord=mapMode==='keys'?spellInKey(n.chord,homeKey()):n.chord;
    n.rootElement.textContent=n.displayChord.rootLabel;
    n.element.style.display=visibleKeys.has(n.key)?'':'none';
    n.element.setAttribute('transform',`translate(${n.x} ${n.y})`);
  }
  svg.classList.toggle('functional-map',mapMode==='keys');
  svg.style.setProperty('--map-ratio',String(layoutWidth/layoutHeight));
  if(cameraMode==='overview')fitMap();
  return true;
}

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
    n.element.setAttribute('aria-label',`${n.displayChord.label}, ${n.chord.qualityName}${active?', selected':viable?', connected option':onRoute?', resolution path':''}. Play this chord.`);
  }
  for(const edge of paths.values()){
    const active=edge.source===current&&targetKeys.has(edge.target.key),route=routeEdges.has(edge.key);
    const visible=visibleKeys.has(edge.source.key)&&visibleKeys.has(edge.target.key);
    const show=visible&&(mapMode==='spectrum'||showAll||active||route);
    edge.p.style.display=show?'':'none';
    if(!show){edge.p.removeAttribute('data-active');continue;}
    positionPath(edge);
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
  n.rootElement=make('tspan',{x:0,y:-3},n.chord.rootLabel);
  text.append(n.rootElement,make('tspan',{x:0,y:18,'font-size':13},TYPES[n.chord.qualityId].suffix||'major'));
  n.roleElement=make('text',{x:0,y:51,'text-anchor':'middle',class:'function-role'});
  g.append(text,n.roleElement);n.element=g;bubbles.append(g);
  g.addEventListener('click',()=>{if(!suppressClick)choose(n);});
  g.addEventListener('pointerenter',()=>{hovered=n.key;paintPaths();});
  g.addEventListener('pointerleave',()=>{hovered=null;paintPaths();});
  g.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(n);}
    if(['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();
      if(mapMode==='keys'){
        const horizontal=e.key==='ArrowRight'||e.key==='ArrowLeft';
        const direction=e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1;
        const distance=other=>{
          const dx=other.x-n.x,dy=other.y-n.y;
          const main=horizontal?dx:dy,cross=horizontal?dy:dx;
          return direction*main>1?Math.abs(main)+2*Math.abs(cross):Infinity;
        };
        const next=[...visibleKeys].map(key=>spectrumByKey.get(key)).sort((a,b)=>distance(a)-distance(b))[0];
        if(next&&Number.isFinite(distance(next))){tabKey=next.key;paintPaths();next.element.focus({preventScroll:true});}
        return;
      }
      let column=n.column,row=n.row;
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
  zoom=Math.max(.55,Math.min(10,zoom));
  const width=layoutWidth/zoom,height=layoutHeight/zoom;
  svg.setAttribute('viewBox',`${center.x-width/2} ${center.y-height/2} ${width} ${height}`);
  $('#zoom-out').disabled=zoom<=.55;$('#zoom-in').disabled=zoom>=10;
}
function fitMap(){
  cameraMode='overview';
  zoom=1;
  center={x:layoutWidth/2,y:layoutHeight/2};
  view();
}
function focusChord(n=current){
  cameraMode='focus';
  center={x:n.x,y:n.y};
  zoom=mapMode==='keys'?1.8:4;
  view();
}
function frameConnections(){
  cameraMode='connections';
  const points=[current,...options.map(o=>spectrumByKey.get(chordKey(o.node))).filter(Boolean)];
  const xs=points.map(n=>n.x),ys=points.map(n=>n.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  center={x:(minX+maxX)/2,y:(minY+maxY)/2};zoom=Math.min(layoutWidth/Math.max(300,maxX-minX+130),layoutHeight/Math.max(230,maxY-minY+135));view();
}
// Account for SVG letterboxing, so panning and pointer-centered zoom agree at
// every screen shape, including inside Faithful Keys' iframe.
function toWorld(clientX,clientY){
  const rect=svg.getBoundingClientRect(),scale=Math.min(rect.width/layoutWidth,rect.height/layoutHeight)*zoom;
  return {x:center.x+(clientX-rect.left-rect.width/2)/scale,y:center.y+(clientY-rect.top-rect.height/2)/scale};
}
svg.addEventListener('wheel',e=>{
  e.preventDefault();cameraMode='free';const before=toWorld(e.clientX,e.clientY);
  zoom=Math.max(.55,Math.min(10,zoom*Math.exp(-e.deltaY*.0015)));
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
    zoom=Math.max(.55,Math.min(10,gesture.zoom*distance/Math.max(gesture.distance,1)));
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
  if(e.detail==='fit'){fitMap();return;}
  if(e.detail==='in'){cameraMode='free';zoom*=1.45;center={x:current.x,y:current.y};}
  if(e.detail==='out'){cameraMode='free';zoom/=1.45;}
  view();
});
function refresh(detail){
  current=spectrumByKey.get(chordKey(detail.chord));if(!current)return;
  options=detail.options;plan=detail.plan;showAll=detail.all;tabKey=current.key;
  for(const option of options){const target=spectrumByKey.get(chordKey(option.node));if(target&&target!==current)addPath(current,target);}
  for(let i=plan.index+1;i<plan.steps.length;i++){
    const source=spectrumByKey.get(chordKey(plan.steps[i-1]));
    const target=spectrumByKey.get(chordKey(plan.steps[i]));
    if(source&&target&&source!==target)addPath(source,target);
  }
  layoutKeyMap();
  for(const [index,button] of keyButtons.entries())button.setAttribute('aria-pressed',String(index===ROOT_ORDER.indexOf(detail.home[1])));
  $('#wheel-heading').textContent=mapMode==='keys'?`${detail.home[0]} major · chord functions`:'Chord spectrum';
  $('#wheel-subtitle').textContent=mapMode==='keys'?'Follow preparation, tension and arrival.':'384 chord bubbles arranged by chord type.';
  paintPaths();
  if(cameraMode==='focus')focusChord();else if(cameraMode==='connections')frameConnections();
  $('#wheel-hint').textContent=`${current.displayChord.label} selected · lit arrows show next movements`;
}
document.addEventListener('chord-paths-selection',e=>refresh(e.detail));

const navigation=document.createElement('div');navigation.className='spectrum-navigation';
navigation.innerHTML='<div class="chord-search"><label for="find-chord" class="sr-only">Find a chord</label><input id="find-chord" type="search" placeholder="Find a chord…" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="chord-results"><div id="chord-results" role="listbox" aria-label="Matching chords" hidden></div></div><div class="spectrum-frame-buttons"><button id="focus-chord">Focus</button><button id="frame-connections">Connections</button></div>';
const keyBar=document.createElement('div');
keyBar.className='function-key-bar';
keyBar.setAttribute('role','group');
keyBar.setAttribute('aria-label','Home key, ordered by fifths');
const keys=['C','G','D','A','E','B','F♯','D♭','A♭','E♭','B♭','F'];
const keyButtons=keys.map((key,index)=>{
  const button=document.createElement('button');
  button.type='button';button.textContent=key;
  button.setAttribute('aria-label',key+' major');
  button.addEventListener('click',()=>{
    if(mapMode==='spectrum')toggleMap();
    cameraMode='overview';
    setHomeKey(index);
    fitMap();
  });
  keyBar.append(button);
  return button;
});
$('.wheel-toolbar').after(keyBar,navigation);
const viewToggle=document.createElement('button');
viewToggle.type='button';viewToggle.className='subtle-button';
viewToggle.textContent='Spectrum';
viewToggle.addEventListener('click',toggleMap);
$('.view-actions').prepend(viewToggle);
function toggleMap(){
  mapMode=mapMode==='keys'?'spectrum':'keys';
  cameraMode='overview';
  viewToggle.textContent=mapMode==='keys'?'Spectrum':'Key map';
  refresh({chord:selectedChord(),options:currentOptions(),plan:currentPlan(),all:$('#all-paths').getAttribute('aria-pressed')==='true',home:homeKey()});
  fitMap();
}
new ResizeObserver(()=>{if(layoutKeyMap())paintPaths();}).observe(svg);
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
    const label=document.createElement('strong');label.textContent=(mapMode==='keys'?spellInKey(n.chord,homeKey()):n.chord).label;label.style.color=n.color;
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
refresh({chord:selectedChord(),options:currentOptions(),plan:currentPlan(),all:false,home:homeKey()});fitMap();
