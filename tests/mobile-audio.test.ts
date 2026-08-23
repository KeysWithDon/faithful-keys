import assert from "node:assert/strict";
import test from "node:test";
import { createInteractiveAudioContext, resumeAudioFromGesture } from "../app/mobile-audio.ts";

test("mobile audio is created, primed, and resumed from the first gesture", async () => {
  let silentStarts = 0;
  let resumes = 0;
  class FakeAudioContext {
    state = "suspended";
    sampleRate = 48000;
    destination = {};
    createBuffer() { return {}; }
    createBufferSource() {
      return { buffer: null, connect() {}, start() { silentStarts += 1; } };
    }
    async resume() { resumes += 1; this.state = "running"; }
  }
  const context = createInteractiveAudioContext(
    { AudioContext: FakeAudioContext as unknown as typeof AudioContext },
    null,
  );
  assert.ok(context);
  assert.equal(await resumeAudioFromGesture(context), true);
  assert.equal(silentStarts, 1);
  assert.equal(resumes, 1);
  assert.equal(createInteractiveAudioContext({}, context), context);
});

test("mobile audio gracefully reports an unavailable Web Audio engine", () => {
  assert.equal(createInteractiveAudioContext({}, null), null);
});
