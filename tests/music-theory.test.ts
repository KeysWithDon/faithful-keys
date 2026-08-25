import assert from "node:assert/strict";
import test from "node:test";
import {buildDiatonicSevenths,buildMajorScale,parseChordParts,parseChordRoot,parseSpelledNote,spellChordInKey,spellChordPitch,spellRomanDegree} from "../app/music-theory.ts";
import {parseChordSymbol} from "../app/voice-leading.ts";

const expected:Record<string,string[]>={
  C:["Cmaj7","Dm7","Em7","Fmaj7","G7","Am7","Bm7♭5"],
  G:["Gmaj7","Am7","Bm7","Cmaj7","D7","Em7","F♯m7♭5"],
  D:["Dmaj7","Em7","F♯m7","Gmaj7","A7","Bm7","C♯m7♭5"],
  A:["Amaj7","Bm7","C♯m7","Dmaj7","E7","F♯m7","G♯m7♭5"],
  E:["Emaj7","F♯m7","G♯m7","Amaj7","B7","C♯m7","D♯m7♭5"],
  B:["Bmaj7","C♯m7","D♯m7","Emaj7","F♯7","G♯m7","A♯m7♭5"],
  "F♯":["F♯maj7","G♯m7","A♯m7","Bmaj7","C♯7","D♯m7","E♯m7♭5"],
  "C♯":["C♯maj7","D♯m7","E♯m7","F♯maj7","G♯7","A♯m7","B♯m7♭5"],
  F:["Fmaj7","Gm7","Am7","B♭maj7","C7","Dm7","Em7♭5"],
  "B♭":["B♭maj7","Cm7","Dm7","E♭maj7","F7","Gm7","Am7♭5"],
  "E♭":["E♭maj7","Fm7","Gm7","A♭maj7","B♭7","Cm7","Dm7♭5"],
  "A♭":["A♭maj7","B♭m7","Cm7","D♭maj7","E♭7","Fm7","Gm7♭5"],
};

test("all twelve teaching keys retain diatonic letter spelling",()=>{for(const [key,chords] of Object.entries(expected)){assert.deepEqual(buildDiatonicSevenths(key),chords);assert.equal(new Set(buildMajorScale(key).map(note=>note[0])).size,7)}});
test("sharp, flat, ASCII, Unicode, and theoretical roots parse safely",()=>{
  for(const [symbol,pc] of [["G♯7",8],["G#7",8],["D♯m7",3],["A♯m7",10],["Dbmaj7",1],["E♯m7",5],["B♯dim7",0],["C♭maj7",11]] as const){assert.equal(parseChordRoot(symbol).root.pitchClass,pc);assert.equal(parseChordSymbol(symbol).root,pc)}
  assert.equal(parseChordRoot("G♯7").suffix,"7"); assert.equal(parseChordRoot("D♯m7").suffix,"m7");
});
test("Roman functions control enharmonic spelling",()=>{
  assert.equal(`${spellRomanDegree("C♯",5)}7`,"G♯7"); assert.equal(`${spellRomanDegree("C♯",2)}m7`,"D♯m7"); assert.equal(`${spellRomanDegree("C♯",7)}dim7`,"B♯dim7");
  assert.equal(`${spellRomanDegree("C♯",3)}m7`,"E♯m7"); assert.equal(`${spellRomanDegree("C♯",6)}7`,"A♯7");
  assert.equal(`${spellRomanDegree("C",2,-1)}7`,"D♭7"); assert.equal(`${spellRomanDegree("F",2,-1)}7`,"G♭7"); assert.equal(spellRomanDegree("A♭",4),"D♭");
});
test("publication spelling follows the selected key",()=>{
  assert.equal(spellChordInKey("D#maj7","E♭"),"E♭maj7");
  assert.equal(spellChordInKey("A#m7/D#","E♭"),"B♭m7/E♭");
  assert.equal(spellChordInKey("Ebmaj7","E"),"D♯maj7");
  assert.equal(spellChordInKey("B#dim7","C♯"),"B♯dim7");
  assert.equal(spellChordInKey("A#m7/D#","E♭"),"B♭m7/E♭");
  assert.equal(spellChordInKey("D#6/9","E♭"),"E♭6/9");
  assert.equal(spellChordInKey("D#m/maj7","E♭"),"E♭m/maj7");
});
test("terminal slash basses stay distinct from slash-based chord qualities",()=>{
  const inversion=parseChordParts("B♭13♭9/E♭");
  assert.equal(inversion.root.display,"B♭"); assert.equal(inversion.suffix,"13♭9"); assert.equal(inversion.slashBass?.display,"E♭");
  const sixNine=parseChordParts("C6/9");
  assert.equal(sixNine.suffix,"6/9"); assert.equal(sixNine.slashBass,null);
  const minorMajor=parseChordParts("Fm/maj7");
  assert.equal(minorMajor.suffix,"m/maj7"); assert.equal(minorMajor.slashBass,null);
});
test("piano labels preserve the active chord's written construction",()=>{assert.equal(spellChordPitch("E♯m7",5),"E♯");assert.equal(spellChordPitch("E♯m7",8),"G♯");assert.equal(spellChordPitch("E♯m7",0),"B♯");assert.equal(spellChordPitch("Fm7",8),"A♭");assert.equal(parseSpelledNote("G♯").pitchClass,parseSpelledNote("A♭").pitchClass)});
