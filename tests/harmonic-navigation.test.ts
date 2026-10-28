import test from 'node:test';
import assert from 'node:assert/strict';
import {
  degrees, generateRoutes, navigationOptions, NAV_KEYS, NAV_VOICINGS,
  transposeNavigation, detectChord, nameForPc, spelledNavigationNote, NAV_PIANO_RANGE, type NavigationRequest, type NavVoicing,
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
  assert.deepEqual(degrees('C').map(x=>x.roman),['I','ii','iii','IV','V','vi','viiø7']);
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
  assert.ok(routes.some(x=>x.family==='Tritone substitution'));
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


test('full concert-grand keyboard range is 88 MIDI keys A0–C8',()=>{
  assert.deepEqual(NAV_PIANO_RANGE,{low:21,high:108});
  assert.equal(NAV_PIANO_RANGE.high-NAV_PIANO_RANGE.low+1,88);
});
test('functional scale degrees keep proper written note names across the circle',()=>{
  assert.deepEqual(degrees('Gb').map(x=>x.name),['G♭','A♭','B♭','C♭','D♭','E♭','F']);
  assert.deepEqual(degrees('B').map(x=>x.name),['B','C♯','D♯','E','F♯','G♯','A♯']);
  assert.deepEqual(degrees('C','minor').map(x=>x.name),['C','D','E♭','F','G','A♭','B♭']);
});
test('ascending chromatics are sharps and descending chromatics are flats unless the key already spells them',()=>{
  assert.equal(nameForPc(1,'C','major','up'),'C♯');
  assert.equal(nameForPc(1,'C','major','down'),'D♭');
  assert.equal(nameForPc(3,'C','major','up'),'D♯');
  assert.equal(nameForPc(3,'C','major','down'),'E♭');
  assert.equal(nameForPc(6,'G','major','down'),'F♯'); // F# is diatonic in G regardless of direction
});
test('functionally correct chromatic approaches match their direction',()=>{
  const upward=generateRoutes({...base,direction:'up',destination:2});
  assert.ok(upward.some(x=>x.family==='Lower-neighbor diminished'&&x.path[0]==='C♯dim7'));
  assert.ok(!upward.some(x=>x.family==='Upper-neighbor diminished'));
  const downward=generateRoutes({...base,direction:'down',destination:2});
  assert.ok(downward.some(x=>x.family==='Upper-neighbor diminished'&&x.path[0]==='E♭dim7'));
  assert.ok(!downward.some(x=>x.family==='Lower-neighbor diminished'));
});
test('minor destination requires minor ii half-diminished and altered dominant, not a major ii-V',()=>{
  const minor=generateRoutes({...base,destination:2,direction:'either'});
  assert.ok(minor.some(x=>x.family==='Functional cadence'&&x.path.join('|')==='Em7b5|A7b9b13|Dm9'));
  const major=generateRoutes({...base,destination:1,direction:'either'});
  assert.ok(major.some(x=>x.family==='Functional cadence'&&x.path.join('|')==='Dm9|G13|Cmaj9'));
});
test('tritone substitutions approach correctly spelled from a semitone above',()=>{
  const c=generateRoutes({...base,destination:1});
  assert.ok(c.some(x=>x.family==='Tritone substitution'&&x.path[0]==='D♭9#11'));
  const d=generateRoutes({...base,destination:2});
  assert.ok(d.some(x=>x.family==='Tritone substitution'&&x.path[0]==='E♭9#11'));
});
test('borrowed minor iv and backdoor dominants terminate on I only',()=>{
  const tonic=generateRoutes({...base,destination:1});
  assert.ok(tonic.some(x=>x.title==='Borrowed minor iv → I'&&x.path.join('|')==='Fm9|Cmaj9'));
  assert.ok(tonic.some(x=>x.title==='Backdoor ♭VII7 → I'&&x.path.join('|')==='B♭13|Cmaj9'));
  const subdominant=generateRoutes({...base,destination:4});
  assert.ok(!subdominant.some(x=>x.classification==='borrowed'&&x.title.includes(' → I')));
});
test('spell actual chord tones with the correct accidental and octave even over B/C boundary',()=>{
  assert.equal(spelledNavigationNote(60,'B#maj7','C'),'B♯3');
  assert.equal(spelledNavigationNote(59,'Cbmaj7','Gb'),'C♭4');
  assert.equal(spelledNavigationNote(70,'G7#9','C'),'A♯4');
  assert.equal(spelledNavigationNote(61,'C#dim7','C'),'C♯4');
});
test('detected chord roots are respelled in key context',()=>{
  const found=detectChord([54,61,66,69],'E');
  assert.ok(found.matches.some(x=>x.startsWith('F♯m')||x.startsWith('F#m')));
  assert.ok(!found.matches.every(x=>x.startsWith('Gb')));
});
test('diatonic transposition preserves written scale-degree letters, including flat-key spelling',()=>{
  assert.equal(transposeNavigation('Dm9',1,'Db','C'),'E♭m9');
  assert.equal(transposeNavigation('G7b9/D',1,'Db','C'),'A♭7b9/E♭');
  assert.equal(transposeNavigation('Dm9',2,'D'),'Em9');
});
test('top-note downward suggestions actually descend on the keyboard',()=>{
  const result=navigationOptions({...base,axis:'top',direction:'down',lock:'none'});
  assert.ok(result.length>0);
  assert.ok(result.every(x=>x.semitoneMotion<0));
});
test('root/bass movement direction corresponds to actual MIDI changes',()=>{
  const up=navigationOptions({...base,axis:'root',direction:'up',palette:'diatonic',destination:3});
  assert.ok(up.length>0);
  assert.ok(up.every(x=>x.semitoneMotion>0));
  const down=navigationOptions({...base,axis:'root',direction:'down',palette:'diatonic',destination:1});
  assert.ok(down.length>0);
  assert.ok(down.every(x=>x.semitoneMotion<0));
});
