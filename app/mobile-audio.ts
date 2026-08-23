type AudioHost = {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

const primedContexts = new WeakSet<AudioContext>();

export function createInteractiveAudioContext(host: AudioHost, current: AudioContext | null) {
  if (current && current.state !== "closed") return current;
  const AudioContextConstructor = host.AudioContext ?? host.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  return new AudioContextConstructor({ latencyHint: "interactive" });
}

/**
 * iOS Safari requires both resume() and an audible graph start to happen while
 * the original pointer/touch event is still on the stack. Starting a one-frame
 * silent buffer satisfies that requirement without changing Cadence's sound.
 */
export function resumeAudioFromGesture(context: AudioContext) {
  if (context.state === "closed") return Promise.resolve(false);

  if (!primedContexts.has(context)) {
    try {
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, context.sampleRate || 44100);
      source.connect(context.destination);
      source.start(0);
      primedContexts.add(context);
    } catch {
      // resume() below still unlocks browsers that do not need a silent frame.
    }
  }

  if (context.state === "running") return Promise.resolve(true);
  try {
    return Promise.resolve(context.resume())
      .then(() => context.state === "running")
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
