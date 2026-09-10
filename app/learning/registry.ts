export const GOALS = ['Beginner Piano', 'Church / Worship Keyboard', 'Gospel Keyboard', 'Jazz Foundations', 'Ear Training Focus', 'Chord Mastery', 'Play By Ear', 'General Musicianship'] as const;
export type LearningGoal = typeof GOALS[number];
export type ExerciseKind = 'note' | 'scale' | 'chord' | 'interval' | 'progression' | 'ear-interval' | 'ear-scale' | 'theory' | 'voice-leading' | 'rhythm';
export type Skill = { id: string; title: string; stage: number; prerequisites: string[]; kind: ExerciseKind; material: string; lesson: string; tags: string[] };
const skill = (id: string, title: string, stage: number, prerequisites: string[], kind: ExerciseKind, material: string, lesson: string, tags: string[] = []): Skill => ({ id, title, stage, prerequisites, kind, material, lesson, tags });
export const SKILLS: Skill[] = [
  skill('notes','Note Recognition',1,[],'note','notes','C is just to the left of each group of two black keys. Move through C D E F G A B, then repeat.'),
  skill('geography','Keyboard Geography',1,['notes'],'note','octaves','An octave repeats a note name twelve semitones higher. Middle C is C4 (MIDI 60).'),
  skill('major-scales','Major Scales',1,['notes'],'scale','major','A major scale follows whole, whole, half, whole, whole, whole, half steps. Play from the tonic up to its octave.'),
  skill('major-triads','Major Triads',1,['notes'],'chord','major','Build a major triad with root, major third and perfect fifth: 0, 4 and 7 semitones above the root.'),
  skill('minor-triads','Minor Triads',1,['major-triads'],'chord','minor','Lower the third of a major triad one semitone: root, minor third, fifth (0, 3, 7).'),
  skill('root-position','Root Position',1,['minor-triads'],'chord','root','Root position means the chord root is the lowest sounding note.'),
  skill('basic-progressions','I–IV–V',1,['major-scales','root-position'],'progression','basic','I is home, IV moves away, and V leads back home. In C: C, F, G, C.'),
  skill('inversions','First Inversions',2,['root-position'],'chord','first','Place the third in the bass. C major first inversion is E–G–C; the root is no longer lowest.'),
  skill('second-inversions','Second Inversions',2,['inversions'],'chord','second','Place the fifth in the bass. C major second inversion is G–C–E.'),
  skill('diatonic','Diatonic Harmony',2,['major-scales','minor-triads'],'theory','diatonic','Major-key triad qualities are I major, ii minor, iii minor, IV major, V major, vi minor, vii diminished.'),
  skill('numbers','Nashville Numbers',2,['diatonic'],'theory','numbers','Numbers describe scale degrees independently of key. In C, 1 is C, 2 is D, 4 is F and 5 is G.'),
  skill('fourths','Circle of Fourths',2,['major-triads'],'note','fourths','Move up five semitones each time: C F B♭ E♭ A♭ D♭ G♭ B E A D G.'),
  skill('fifths','Circle of Fifths',2,['major-triads'],'note','fifths','Move up seven semitones each time: C G D A E B F♯ D♭ A♭ E♭ B♭ F.'),
  skill('voice-leading','Basic Voice Leading',2,['second-inversions'],'voice-leading','triads','Keep common tones and move the other voices by the smallest practical distance. Preserve every chord tone.'),
  skill('worship','Worship Progressions',2,['numbers','voice-leading'],'progression','worship','Practice I–V–vi–IV as a connected phrase. Keep a steady pulse and use inversions to reduce motion.',['worship']),
  skill('basic-intervals','Basic Intervals',3,['notes'],'ear-interval','basic','Compare the distance between notes. Begin with the open sound of a perfect fifth and the repeated pitch of an octave.',['ear']),
  skill('intervals','Interval Recognition',3,['basic-intervals'],'ear-interval','intervals','A minor third spans three semitones; a major third spans four. Compare their sound before answering.',['ear']),
  skill('advanced-intervals','Advanced Intervals',3,['intervals'],'ear-interval','compound','Compound intervals extend beyond an octave. Add twelve semitones without losing the interval quality.',['ear']),
  skill('minor-scales','Minor Scales',3,['major-scales'],'scale','natural-minor','Natural minor follows whole, half, whole, whole, half, whole, whole steps.'),
  skill('scale-recognition','Scale Recognition',3,['minor-scales','basic-intervals'],'ear-scale','basic','Listen to the third and sixth to distinguish major from natural minor.',['ear']),
  skill('chord-recognition','Chord Recognition',3,['minor-triads','intervals'],'chord','recognize','Listen to the chord, then reproduce it. Identify its major or minor third.',['ear']),
  skill('progression-recognition','Progression Recognition',3,['numbers','chord-recognition'],'progression','playback','Listen to the bass movement and reproduce each chord in order.',['ear']),
  skill('rhythm','Rhythm',3,['notes'],'rhythm','pulse','Tap four steady beats. Accuracy here concerns equal spacing, not how quickly you begin.'),
  skill('sevenths','Seventh Chords',4,['minor-triads','voice-leading'],'chord','sevenths','Add a seventh: major seventh is 11 semitones; dominant and minor seventh use 10.'),
  skill('diminished','Diminished Chords',4,['minor-triads'],'chord','dim','A diminished triad contains root, minor third and diminished fifth: 0, 3, 6.'),
  skill('augmented','Augmented Chords',4,['major-triads'],'chord','aug','Raise the fifth of a major triad: 0, 4, 8.'),
  skill('suspended','Suspended & Add Chords',4,['major-triads'],'chord','sus','Sus2 and sus4 replace the third with 2 or 5 semitones. Add9 retains the third and adds the ninth.'),
  skill('slash','Slash Chords',4,['second-inversions'],'chord','slash','The note after the slash is the required bass. C/E means a C chord with E lowest.'),
  skill('extensions','Extensions',4,['sevenths'],'chord','extensions','Build ninths, elevenths and thirteenths above the seventh. These studies retain the complete written stack.'),
  skill('secondary','Secondary Dominants',4,['sevenths','numbers'],'progression','secondary','A temporary dominant points to another chord. In C, D7 leads to G: V7/V → V.'),
  skill('passing','Passing Chords',4,['secondary','diminished'],'progression','passing','Use a connecting chord to approach your destination. C → C♯dim7 → Dm connects I to ii.'),
  skill('gospel','Gospel Progressions',5,['passing','worship','extensions'],'progression','gospel','Practice I–vi–ii–V and ii–V–I with clear guide tones. Resolve tension into the destination.',['gospel']),
  skill('diminished-movement','Diminished Passing Movement',5,['passing'],'progression','passing','A diminished seventh can approach the next chord chromatically. Listen for each voice resolving.',['gospel']),
  skill('ccm','CCM Movement',5,['worship','sevenths'],'progression','worship','Connect I–V–vi–IV with seventh colors while keeping the melody space clear.',['worship']),
  skill('modulation','Modulation',5,['secondary','gospel'],'progression','modulation','Establish a new key through its dominant and tonic. C → A7 → D establishes D.'),
  skill('modes','Modes',6,['scale-recognition'],'scale','dorian','Dorian is minor with a raised sixth. Mixolydian is major with a lowered seventh.'),
  skill('mode-recognition','Mode Recognition',6,['modes'],'ear-scale','modes','Distinguish Dorian from natural minor and Mixolydian from major by their characteristic degrees.',['ear']),
  skill('altered','Altered Dominants',6,['extensions','secondary'],'chord','altered','Alter a dominant fifth or ninth to intensify its resolution. Retain the third and seventh.'),
  skill('substitutions','Substitutions',6,['altered'],'progression','substitution','A dominant a tritone away shares the guide tones. In C, D♭7 can replace G7 before C.'),
  skill('reharmonization','Reharmonization',6,['substitutions','modulation'],'progression','reharm','Use secondary dominants and substitutions while preserving the harmonic destination.'),
  skill('upper-structures','Upper Structures',6,['altered','modes'],'chord','upper','A D major triad over C7 supplies 9, ♯11 and 13 while C, E, B♭ supply the foundation.'),
  skill('advanced-voicings','Advanced Voice Leading',6,['upper-structures','voice-leading'],'voice-leading','sevenths','Keep guide tones connected and minimize movement between extended harmonies.'),
  skill('jazz','Jazz Harmony',6,['reharmonization','advanced-voicings'],'progression','jazz','Connect ii7–V7–Imaj7. Hear the dominant seventh resolve down and the third resolve up.',['jazz']),
  skill('play-by-ear','Play By Ear',6,['progression-recognition','mode-recognition'],'progression','playback','Listen first; reproduce the bass and chord qualities without a written answer.',['ear']),
  skill('improvisation','Improvisation Foundations',6,['jazz','modes'],'scale','dorian','Begin by locating chord tones and connecting them with the Dorian scale. This foundation drill checks vocabulary, not artistic creativity.',['jazz']),
];
export const SKILL_MAP = Object.fromEntries(SKILLS.map(s => [s.id, s]));
export const STAGES = ['Keyboard Foundations','Functional Playing','Ear Development','Intermediate Harmony','Gospel / Contemporary Playing','Advanced Musicianship'];
// Full tools expose many sub-controls. Require their complete capability set;
// earlier lessons use scoped exercises without exposing advanced controls.
export const FEATURES: Record<string, { title: string; requires: string[] }> = {
  common: { title: 'Common progressions', requires: ['reharmonization','extensions'] },
  custom: { title: 'Build Your Own', requires: ['reharmonization','advanced-voicings'] },
  resolve: { title: 'Resolution lab', requires: ['substitutions','extensions'] },
  circle: { title: 'Circle warm-up', requires: ['fourths','fifths','secondary','extensions'] },
  standards: { title: 'Jazz standards', requires: ['jazz'] },
  gospel: { title: 'Gospel standards', requires: ['gospel','reharmonization'] },
  ear: { title: 'Full Ear Training', requires: ['advanced-intervals','mode-recognition'] },
};
