import assert from "node:assert/strict";
import test from "node:test";
import {
  ORCHESTRA_SAMPLE_MANIFEST,
  orchestraRegionsForNote,
  parseWavLoop,
} from "../app/sso-instruments.ts";

test("string and French horn ensembles remain independent sound manifests", () => {
  assert.ok(ORCHESTRA_SAMPLE_MANIFEST.strings.length > 1);
  assert.ok(ORCHESTRA_SAMPLE_MANIFEST.horns.length > 1);
  assert.ok(ORCHESTRA_SAMPLE_MANIFEST.strings.every(region => region.section !== "horns"));
  assert.ok(ORCHESTRA_SAMPLE_MANIFEST.horns.every(region => region.section === "horns"));
  assert.ok(orchestraRegionsForNote("strings", 60).length > 1);
  assert.equal(orchestraRegionsForNote("horns", 60).length, 1);
});

test("every reduced SSO browser multisample uses the immutable v4.0 source", () => {
  for (const region of [...ORCHESTRA_SAMPLE_MANIFEST.strings, ...ORCHESTRA_SAMPLE_MANIFEST.horns]) {
    assert.match(region.file, /^https:\/\/raw\.githubusercontent\.com\/peastman\/sso\/64a66eda18c5cc1039a56c902d0555df56742300\//);
    assert.match(region.file, /\.wav$/);
  }
});

test("the browser player retains embedded WAV sustain loops", () => {
  const data = new ArrayBuffer(80);
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  const writeAscii = (offset: number, value: string) => [...value].forEach((character, index) => { bytes[offset + index] = character.charCodeAt(0); });
  writeAscii(0, "RIFF");
  writeAscii(8, "WAVE");
  writeAscii(12, "smpl");
  view.setUint32(16, 60, true);
  view.setUint32(48, 1, true);
  view.setUint32(64, 17_755, true);
  view.setUint32(68, 151_550, true);
  const loop = parseWavLoop(data);
  assert.ok(loop);
  assert.ok(loop.endFrame > loop.startFrame);
});
