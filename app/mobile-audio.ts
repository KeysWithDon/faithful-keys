type AudioHost = {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

const primedContexts = new WeakSet<AudioContext>();

export function createInteractiveAudioContext(host: AudioHost, current: AudioContext | null) {
  const currentState = current ? String(current.state) : "closed";
  // WebKit exposes an extra `interrupted` state on iPhone/iPad. Reusing that
  // context can report success while remaining completely silent.
  if (current && currentState !== "closed" && currentState !== "interrupted") return current;
  const AudioContextConstructor = host.AudioContext ?? host.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  try {
    return new AudioContextConstructor({ latencyHint: "interactive" });
  } catch {
    // Older Safari builds accept the constructor but reject AudioContextOptions.
    try { return new AudioContextConstructor(); } catch { return null; }
  }
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
    // Call resume synchronously while the click is still a trusted gesture.
    const resume = context.resume();
    return new Promise(resolve => {
      const timeout = setTimeout(() => resolve(false), 1200);
      Promise.resolve(resume).then(() => {
        clearTimeout(timeout);
        resolve(context.state === "running");
      }).catch(() => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  } catch {
    return Promise.resolve(false);
  }
}
