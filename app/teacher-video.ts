import {drawRecordedMap,type RecordedMap} from './teacher-map-video';
import {readerWrittenNote} from './chord-reader-notation';

export const teacherPianoRange = [33, 96] as const;
export type TeacherVideoFrame = {notes: number[]; shared: number[]; label: string; leftHand?: number[]; rightHand?: number[]};
export type VideoPress = {label: string; key: string|null; note: number|null};
export type TeacherRecordingFrame = TeacherVideoFrame & {map?: RecordedMap; presses?: (VideoPress & {strength: number})[]};
const notes = Array.from({length: teacherPianoRange[1] - teacherPianoRange[0] + 1}, (_, i) => teacherPianoRange[0] + i);
const isBlack = (note: number) => [1, 3, 6, 8, 10].includes(note % 12);
const whites = notes.filter(note => !isBlack(note));
const blacks = notes.filter(isBlack);
export const teacherNoteName = (note: number) => {
  const written = readerWrittenNote(note);
  return written.name + written.octave;
};

export function drawTeacherVideo(ctx: CanvasRenderingContext2D, frame: TeacherRecordingFrame, elapsed: number) {
  const text = (value: string, x: number, y: number, size: number, color: string, maxWidth = 1160) => {
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.fillText(value, x, y, maxWidth);
  };
  ctx.fillStyle = '#10151f';
  ctx.fillRect(0, 0, 1280, 720);
  text('FAITHFUL KEYS  /  CHORD TEACHER', 54, 44, 21, '#d5c08a');
  if(frame.map){
    text(`${frame.map.key} major · Key map`,54,72,17,'#c9d1dc');
    const nodeFlashes=new Map<string,number>();
    for(const press of frame.presses??[])if(press.key)nodeFlashes.set(press.key,press.strength);
    drawRecordedMap(ctx,frame.map,nodeFlashes);
  }
  const seconds = Math.floor(elapsed / 1000);
  ctx.textAlign = 'right';
  text(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, 1226, 44, 21, '#c0c8d5');
  const latest=frame.presses?.at(-1);
  if(latest?.label){
    ctx.globalAlpha=latest.strength;
    text(latest.label,1226,72,19,'#ffe7a4',420);
    ctx.globalAlpha=1;
  }
  ctx.textAlign = 'left';
  const chord=frame.label || (frame.notes.length===1?teacherNoteName(frame.notes[0]):'Piano');
  text(chord,54,536,31,'#f6f1df',215);
  if(frame.leftHand?.length&&frame.rightHand?.length){
    const hands=`LH ${frame.leftHand.map(teacherNoteName).join(' · ')}     RH ${frame.rightHand.map(teacherNoteName).join(' · ')}`;
    text(hands,285,533,18,'#d5c08a',940);
  }
  const left = 54;
  const top = 550;
  const width = 1172 / whites.length;
  const highlight = (note: number, normal: string) =>
    frame.shared.includes(note) ? '#78d4b0' : frame.notes.includes(note) ? '#e2b714' : normal;
  const pianoFlashes=new Map<number,number>();
  for(const press of frame.presses??[])if(press.note!==null)pianoFlashes.set(press.note,press.strength);
  const flashKey=(note:number,x:number,y:number,w:number,h:number)=>{
    const strength=pianoFlashes.get(note);
    if(!strength)return;
    ctx.globalAlpha=strength*.85;
    ctx.fillStyle='#fff0b6';
    ctx.fillRect(x,y,w,h);
    ctx.globalAlpha=1;
  };
  whites.forEach((note, index) => {
    const x = left + index * width;
    ctx.fillStyle = highlight(note, '#f5f1e8');
    ctx.fillRect(x + 1, top, width - 2, 133);
    flashKey(note,x+1,top,width-2,133);
    if(note % 12 === 0)text(teacherNoteName(note), x + 3, top + 121, 13, '#293752', width - 6);
  });
  blacks.forEach(note => {
    const boundary = whites.findIndex(white => white > note);
    ctx.fillStyle = highlight(note, '#212a3b');
    const x=left+boundary*width-width*.31;
    ctx.fillRect(x,top,width*.62,83);
    flashKey(note,x,top,width*.62,83);
  });
  text('● Voicing', 54, 709, 15, '#e2b714');
  text('● Shared notes', 162, 709, 15, '#78d4b0');
}
