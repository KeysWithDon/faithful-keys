import {readerWrittenNote} from './chord-reader-notation';

export const teacherPianoRange = [33, 96] as const;
export type TeacherVideoFrame = {notes: number[]; shared: number[]; label: string; leftHand?: number[]; rightHand?: number[]};
const notes = Array.from({length: teacherPianoRange[1] - teacherPianoRange[0] + 1}, (_, i) => teacherPianoRange[0] + i);
const isBlack = (note: number) => [1, 3, 6, 8, 10].includes(note % 12);
const whites = notes.filter(note => !isBlack(note));
const blacks = notes.filter(isBlack);
export const teacherNoteName = (note: number) => {
  const written = readerWrittenNote(note);
  return written.name + written.octave;
};

export function drawTeacherVideo(ctx: CanvasRenderingContext2D, frame: TeacherVideoFrame, elapsed: number) {
  const text = (value: string, x: number, y: number, size: number, color: string, maxWidth = 1160) => {
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.fillText(value, x, y, maxWidth);
  };
  ctx.fillStyle = '#10151f';
  ctx.fillRect(0, 0, 1280, 720);
  text('FAITHFUL KEYS  /  CHORD TEACHER', 54, 66, 22, '#d5c08a');
  const seconds = Math.floor(elapsed / 1000);
  ctx.textAlign = 'right';
  text(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, 1226, 66, 22, '#c0c8d5');
  ctx.textAlign = 'center';
  text(frame.label || (frame.notes.length === 1 ? teacherNoteName(frame.notes[0]) : 'Performance'), 640, 265, 96, '#f6f1df');
  text(frame.notes.map(teacherNoteName).join('  ·  '), 640, 337, 28, '#c9d1dc');
  if(frame.leftHand?.length&&frame.rightHand?.length){
    const hands=`LH ${frame.leftHand.map(teacherNoteName).join(' · ')}     RH ${frame.rightHand.map(teacherNoteName).join(' · ')}`;
    text(hands, 640, 382, 20, '#d5c08a');
  }
  ctx.textAlign = 'left';
  const left = 54;
  const top = 418;
  const width = 1172 / whites.length;
  const highlight = (note: number, normal: string) =>
    frame.shared.includes(note) ? '#78d4b0' : frame.notes.includes(note) ? '#e2b714' : normal;
  whites.forEach((note, index) => {
    const x = left + index * width;
    ctx.fillStyle = highlight(note, '#f5f1e8');
    ctx.fillRect(x + 1, top, width - 2, 190);
    if(note % 12 === 0)text(teacherNoteName(note), x + 3, top + 174, 13, '#293752', width - 6);
  });
  blacks.forEach(note => {
    const boundary = whites.findIndex(white => white > note);
    ctx.fillStyle = highlight(note, '#212a3b');
    ctx.fillRect(left + boundary * width - width * .31, top, width * .62, 118);
  });
  text('● Voicing', 54, 661, 20, '#e2b714');
  text('● Shared notes', 183, 661, 20, '#78d4b0');
}
