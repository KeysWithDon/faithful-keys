/**
 * Browser-sized multisample players derived from the Sonatina Symphonic
 * Orchestra. Samples stay separate from the synth EP and piano engines and
 * are fetched only after the musician selects an orchestral sound.
 */

export type OrchestraPatch = "strings" | "horns";

export type OrchestraNoteStop = (time?: number) => void;

export type OrchestraInstrument = {
  ready: Promise<unknown>;
  start: (event: { note: number; time?: number; duration?: number; velocity?: number }) => OrchestraNoteStop;
};

type OrchestraSection = "basses" | "celli" | "violas" | "violins" | "horns";

const SSO_SAMPLE_ROOT = "https://raw.githubusercontent.com/peastman/sso/64a66eda18c5cc1039a56c902d0555df56742300/Sonatina%20Symphonic%20Orchestra/Samples";

function ssoSample(section: string, name: string) {
  return `${SSO_SAMPLE_ROOT}/${encodeURIComponent(section)}/${encodeURIComponent(name)}`;
}

export type OrchestraSampleRegion = {
  section: OrchestraSection;
  rootMidi: number;
  file: string;
  tuneCents?: number;
};

const STRING_REGIONS: OrchestraSampleRegion[] = [
  { section: "basses", rootMidi: 36, file: ssoSample("Basses", "basses-sus-c2.wav") },
  { section: "basses", rootMidi: 42, file: ssoSample("Basses", "basses-sus-f#2.wav") },
  { section: "basses", rootMidi: 48, file: ssoSample("Basses", "basses-sus-c3.wav") },
  { section: "basses", rootMidi: 54, file: ssoSample("Basses", "basses-sus-f#3.wav") },
  { section: "basses", rootMidi: 60, file: ssoSample("Basses", "basses-sus-c4.wav") },

  { section: "celli", rootMidi: 39, file: ssoSample("Celli", "celli-sus-d#2.wav") },
  { section: "celli", rootMidi: 42, file: ssoSample("Celli", "celli-sus-f#2.wav") },
  { section: "celli", rootMidi: 48, file: ssoSample("Celli", "celli-sus-c3.wav") },
  { section: "celli", rootMidi: 54, file: ssoSample("Celli", "celli-sus-f#3.wav") },
  { section: "celli", rootMidi: 60, file: ssoSample("Celli", "celli-sus-c4.wav") },
  { section: "celli", rootMidi: 66, file: ssoSample("Celli", "celli-sus-f#4.wav") },
  { section: "celli", rootMidi: 72, file: ssoSample("Celli", "celli-sus-c5.wav") },

  { section: "violas", rootMidi: 48, file: ssoSample("Violas", "violas-sus-c3.wav") },
  { section: "violas", rootMidi: 54, file: ssoSample("Violas", "violas-sus-f#3.wav") },
  { section: "violas", rootMidi: 60, file: ssoSample("Violas", "violas-sus-c4.wav") },
  { section: "violas", rootMidi: 66, file: ssoSample("Violas", "violas-sus-f#4.wav") },
  { section: "violas", rootMidi: 72, file: ssoSample("Violas", "violas-sus-c5.wav") },
  { section: "violas", rootMidi: 78, file: ssoSample("Violas", "violas-sus-f#5.wav") },
  { section: "violas", rootMidi: 84, file: ssoSample("Violas", "violas-sus-c6.wav") },

  { section: "violins", rootMidi: 55, file: ssoSample("1st Violins", "1st-violins-sus-g3.wav") },
  { section: "violins", rootMidi: 61, file: ssoSample("1st Violins", "1st-violins-sus-c#4.wav") },
  { section: "violins", rootMidi: 67, file: ssoSample("1st Violins", "1st-violins-sus-g4.wav") },
  { section: "violins", rootMidi: 73, file: ssoSample("1st Violins", "1st-violins-sus-c#5.wav") },
  { section: "violins", rootMidi: 79, file: ssoSample("1st Violins", "1st-violins-sus-g5.wav") },
  { section: "violins", rootMidi: 85, file: ssoSample("1st Violins", "1st-violins-sus-c#6.wav") },
];

const HORN_REGIONS: OrchestraSampleRegion[] = [
  { section: "horns", rootMidi: 40, file: ssoSample("Horns", "horns-sus-mp-e2-PB-loop.wav"), tuneCents: -4 },
  { section: "horns", rootMidi: 46, file: ssoSample("Horns", "horns-sus-mp-a#2-PB-loop.wav"), tuneCents: -2 },
  { section: "horns", rootMidi: 52, file: ssoSample("Horns", "horns-sus-mp-e3-PB-loop.wav") },
  { section: "horns", rootMidi: 58, file: ssoSample("Horns", "horns-sus-mp-a#3-PB-loop.wav") },
  { section: "horns", rootMidi: 64, file: ssoSample("Horns", "horns-sus-mp-e4-PB-loop.wav") },
  { section: "horns", rootMidi: 70, file: ssoSample("Horns", "horns-sus-mp-a#4-PB-loop.wav") },
  { section: "horns", rootMidi: 76, file: ssoSample("Horns", "horns-sus-mp-e5-PB-loop.wav") },
];

export const ORCHESTRA_SAMPLE_MANIFEST: Record<OrchestraPatch, readonly OrchestraSampleRegion[]> = {
  strings: STRING_REGIONS,
  horns: HORN_REGIONS,
};

type WaveLoop = { startFrame: number; endFrame: number };
type LoadedRegion = OrchestraSampleRegion & { buffer: AudioBuffer; loop: WaveLoop | null };

function readAscii(view: DataView, offset: number, length: number) {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(view.getUint8(offset + index));
  return value;
}

/** Read the first standard RIFF `smpl` loop without relying on browser metadata. */
export function parseWavLoop(data: ArrayBuffer): WaveLoop | null {
  if (data.byteLength < 20) return null;
  const view = new DataView(data);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") return null;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (chunkId === "smpl" && chunkSize >= 60 && dataOffset + chunkSize <= view.byteLength) {
      const loopCount = view.getUint32(dataOffset + 28, true);
      if (loopCount > 0) {
        const loopOffset = dataOffset + 36;
        const startFrame = view.getUint32(loopOffset + 8, true);
        const endFrame = view.getUint32(loopOffset + 12, true);
        return endFrame > startFrame ? { startFrame, endFrame } : null;
      }
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  return null;
}

function closestRegion(regions: readonly OrchestraSampleRegion[], note: number) {
  return regions.reduce((closest, region) => (
    Math.abs(region.rootMidi - note) < Math.abs(closest.rootMidi - note) ? region : closest
  ));
}

function stringSectionsForNote(note: number): OrchestraSection[] {
  if (note < 48) return ["basses", "celli"];
  if (note < 55) return ["basses", "celli", "violas"];
  if (note <= 72) return ["celli", "violas", "violins"];
  return ["violas", "violins"];
}

/** Exposed for regression tests and to keep range/layer decisions deterministic. */
export function orchestraRegionsForNote(patch: OrchestraPatch, note: number) {
  if (patch === "horns") return [closestRegion(HORN_REGIONS, note)];
  return stringSectionsForNote(note).map(section => (
    closestRegion(STRING_REGIONS.filter(region => region.section === section), note)
  ));
}

function sampleUrl(file: string) {
  return new URL(file, document.baseURI).href;
}

async function loadRegion(context: AudioContext, region: OrchestraSampleRegion): Promise<LoadedRegion> {
  const response = await fetch(sampleUrl(region.file));
  if (!response.ok) throw new Error(`Unable to load ${region.file} (${response.status})`);
  const source = await response.arrayBuffer();
  const loop = parseWavLoop(source);
  const buffer = await context.decodeAudioData(source.slice(0));
  return { ...region, buffer, loop };
}

type SharedRoom = { input: GainNode };
const rooms = new WeakMap<AudioContext, SharedRoom>();

function sharedOrchestraRoom(context: AudioContext) {
  const existing = rooms.get(context);
  if (existing) return existing;

  const input = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const convolver = context.createConvolver();
  const compressor = context.createDynamicsCompressor();
  const impulse = context.createBuffer(2, Math.floor(context.sampleRate * 1.45), context.sampleRate);
  let seed = 1947;
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const values = impulse.getChannelData(channel);
    for (let index = 0; index < values.length; index += 1) {
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647) * 2 - 1;
      values[index] = noise * Math.pow(1 - index / values.length, 2.8);
    }
  }
  convolver.buffer = impulse;
  dry.gain.value = 0.82;
  wet.gain.value = 0.16;
  compressor.threshold.value = -19;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.012;
  compressor.release.value = 0.22;
  input.connect(dry).connect(compressor);
  input.connect(wet).connect(convolver).connect(compressor);
  compressor.connect(context.destination);
  const room = { input };
  rooms.set(context, room);
  return room;
}

export function createOrchestraInstrument(context: AudioContext, patch: OrchestraPatch): OrchestraInstrument {
  const loaded = new Map<string, LoadedRegion>();
  const room = sharedOrchestraRoom(context);
  const ready = Promise.all(ORCHESTRA_SAMPLE_MANIFEST[patch].map(async region => {
    const sample = await loadRegion(context, region);
    loaded.set(region.file, sample);
  }));

  return {
    ready,
    start(event) {
      const selected = orchestraRegionsForNote(patch, event.note);
      const startAt = Math.max(context.currentTime, event.time ?? context.currentTime);
      const duration = Math.max(0.12, event.duration ?? 1.15);
      const release = patch === "strings" ? 0.3 : 0.22;
      const attack = patch === "strings" ? 0.065 : 0.035;
      const velocity = Math.max(1, Math.min(127, event.velocity ?? 92)) / 127;
      const layerLevel = (patch === "strings" ? 0.2 : 0.26) * (0.38 + Math.pow(velocity, 1.35) * 0.62) / Math.sqrt(selected.length);
      const voices: Array<{ source: AudioBufferSourceNode; gain: GainNode }> = [];

      selected.forEach(region => {
        const sample = loaded.get(region.file);
        if (!sample) return;
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = sample.buffer;
        source.playbackRate.setValueAtTime(
          Math.pow(2, (event.note - region.rootMidi + (region.tuneCents ?? 0) / 100) / 12),
          startAt,
        );
        if (sample.loop) {
          source.loop = true;
          source.loopStart = sample.loop.startFrame / sample.buffer.sampleRate;
          source.loopEnd = sample.loop.endFrame / sample.buffer.sampleRate;
        }
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.linearRampToValueAtTime(layerLevel, startAt + attack);
        gain.gain.setValueAtTime(layerLevel, startAt + duration);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration + release);
        source.connect(gain).connect(room.input);
        source.start(startAt);
        source.stop(startAt + duration + release + 0.04);
        voices.push({ source, gain });
      });

      let stopped = false;
      return (requestedTime = context.currentTime) => {
        if (stopped) return;
        stopped = true;
        const stopAt = Math.max(context.currentTime, requestedTime);
        voices.forEach(({ source, gain }) => {
          try {
            gain.gain.cancelScheduledValues(stopAt);
            gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), stopAt);
            gain.gain.exponentialRampToValueAtTime(0.0001, stopAt + 0.09);
            source.stop(stopAt + 0.1);
          } catch {
            // The scheduled sample may already have completed naturally.
          }
        });
      };
    },
  };
}
