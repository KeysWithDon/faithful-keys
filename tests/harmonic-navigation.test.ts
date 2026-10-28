import test from 'node:test';
import assert from 'node:assert/strict';
import {
  degrees, generateRoutes, navigationOptions, NAV_KEYS, NAV_VOICINGS,
  transposeNavigation, detectChord, type NavigationRequest, type NavVoicing,
} from '../app/harmonic-navigation.ts';

const base: NavigationRequest = {
  key:'C',mode:'major',current:'Dm7',held:[50,57,62,65,72],
  direction:'either',axis:'root',palette:'all',voicing:'drop2',
  texture:'modern-gospel',tension:50,density:6,lock:'none',range:'middle',
};

test('12 supported keys and major/minor seven-degree maps',()=>{
  assert.equal(NAV_KEYS.length,12);
  for(const key of NAV_KEYS)for(const mode of ['major','minor'] as const){
    const d=degrees(key,mode);assert.equal(d.length,7);
    assert.equal(new Set(d.map(x=>x.pc)).size,7);
    assert.equal(d[0].name.length>0,true);
  }
});
test('D minor in C is the ii chord',()=>{
  assert.deepEqual(degrees('C').map(x=>x.roman),['I','ii','iii','IV','V','vi','vii°']);
  assert.equal(degrees('C')[1].name,'D');
  const detected=detectChord([50,57,62,65,72],'C');
  assert.ok(detected.matches.some(x=>x.startsWith('Dm7')));
});
test('independent voicing families are exposed',()=>{
  assert.ok(NAV_VOICINGS.length>=18);
  assert.equal(new Set(NAV_VOICINGS.map(x=>x.id)).size,NAV_VOICINGS.length);
  for(const name of ['drop2','drop3','drop24','rootless-a','rootless-b','quartal','quintal','upper','gospel','spread','cluster','block','hybrid','shell'] as NavVoicing[])
    assert.ok(NAV_VOICINGS.some(x=>x.id===name));
});
test('diatonic routes stay diatonic',()=>{
  const routes=generateRoutes({...base,palette:'diatonic'});
  assert.ok(routes.length>=5);
  assert.ok(routes.every(r=>r.classification==='diatonic'));
  assert.ok(routes.some(r=>r.path.join('').includes('Fmaj9')));
});
test('altered tension, tritone and modulation routes',()=>{
  const routes=generateRoutes({...base,palette:'all',destination:1,modulationKey:'F'});
  assert.ok(routes.some(x=>x.family==='Altered resolution'));
  assert.ok(routes.some(x=>x.family==='Tritone color'));
  assert.ok(routes.some(x=>x.classification==='modulation'));
});
test('each voicing strategy generates playable paths when available',()=>{
  const active= NAV_VOICINGS.map(item=>({style:item.id,options:navigationOptions({...base,voicing:item.id,destination:4})}));
  assert.ok(active.filter(x=>x.options.length>0).length>=14);
  for(const {options} of active)for(const o of options){
    assert.equal(o.path.length,o.voicedPath.length);
    assert.ok(o.upper.every(n=>n>=46&&n<=91));
    assert.ok(o.voicedPath.every(notes=>notes.every(Number.isInteger)));
    assert.ok(o.bass>=30&&o.bass<=62);
  }
});
test('Drop 2 creates spread four-note right hand rather than a close-position label',()=>{
  const drop=navigationOptions({...base,voicing:'drop2',destination:3,palette:'diatonic'});
  assert.ok(drop.length);
  assert.equal(drop[0].upper.length,4);
  assert.ok(drop[0].upper.at(-1)!-drop[0].upper[0]>=10);
});
test('rootless A and B use distinct hand patterns',()=>{
  const a=navigationOptions({...base,voicing:'rootless-a',destination:5});
  const b=navigationOptions({...base,voicing:'rootless-b',destination:5});
  assert.ok(a.length&&b.length);
  assert.notDeepEqual(a[0].upper,b[0].upper);
});
test('direction for top note only offers upward motion when upward selected',()=>{
  const options=navigationOptions({...base,axis:'top',direction:'up',destination:null,lock:'none'});
  assert.ok(options.length>0);
  assert.ok(options.every(x=>x.semitoneMotion>0));
});
test('lock top common pitch preserves top-note class when possible',()=>{
  const options=navigationOptions({...base,axis:'root',direction:'either',lock:'top'});
  assert.ok(options.length>0);
  assert.ok(options.every(x=>x.upper.some(n=>n%12===72%12)));
});
test('transpose one progression to another key without damaging chord quality',()=>{
  assert.equal(transposeNavigation('Dm9',2,'D'),'Em9');
  assert.equal(transposeNavigation('G7b9/D',2,'D'),'A7b9/E');
});
