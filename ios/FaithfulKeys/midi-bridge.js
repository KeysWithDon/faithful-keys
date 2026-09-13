/* Input-only Web MIDI adapter for the bundled Faithful Keys page.
   No MIDI output, SysEx, arbitrary native calls, or remote-page access. */
(() => {
  'use strict';
  if (window.top !== window || location.protocol !== 'faithful-keys:' || location.host !== 'app') return;
  const handler = window.webkit?.messageHandlers?.faithfulKeys;
  if (!handler) return;
  const post = message => handler.postMessage(message);
  const inputs = new Map();
  const access = { inputs, outputs: new Map(), sysexEnabled: false, onstatechange: null };
  let pending = null;
  let enabled = false;
  let generation = 0;
  let fileRequest = null;
  function panic() {
    for (const input of inputs.values()) input.onmidimessage?.({ data: new Uint8Array([0xb0, 123, 0]), timeStamp: performance.now() });
  }
  function disconnect() {
    ++generation;
    enabled = false;
    panic();
    if (pending) { clearTimeout(pending.timer); pending.reject(new DOMException('MIDI connection cancelled.', 'AbortError')); pending = null; }
    post({ action: 'stop' });
  }
  Object.defineProperty(window, 'faithfulKeysIOS', { value: Object.freeze({
    bluetooth: () => post({ action: 'bluetooth' }),
    disconnect,
    saveProgression: (name, text) => new Promise((resolve, reject) => {
      if (fileRequest) return reject(new Error('Finish the current save first.'));
      if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) return reject(new Error('Progression is too large.'));
      fileRequest = { resolve, reject };
      post({ action: 'save', name, text });
    }),
  }) });
  Object.defineProperty(navigator, 'requestMIDIAccess', { value: (options = {}) => {
    if (options.sysex) return Promise.reject(new DOMException('SysEx is not supported.', 'NotSupportedError'));
    if (enabled) return Promise.resolve(access);
    if (pending) return pending.promise;
    const requestID = ++generation;
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => {
      if (pending?.id !== requestID) return;
      pending = null;
      ++generation;
      post({ action: 'stop' });
      reject(new Error('MIDI did not respond. Try connecting again.'));
    }, 10000);
    pending = { id: requestID, resolve, reject, promise, timer };
    post({ action: 'start', id: requestID });
    return promise;
  } });
  Object.defineProperty(window, '__faithfulKeysReceive', { value: payload => {
    if (payload.type === 'saved') {
      const request = fileRequest; fileRequest = null;
      if (payload.error) request?.reject(new Error(payload.error));
      else request?.resolve(Boolean(payload.completed));
      return;
    }
    if (payload.type === 'panic') { panic(); return; }
    if (payload.type === 'error') {
      if (pending?.id === payload.id) {
        clearTimeout(pending.timer); pending.reject(new Error(payload.message)); pending = null;
      }
      return;
    }
    if (payload.id !== generation) return;
    if (payload.type === 'devices') {
      const old = [...inputs.values()];
      const connected = new Set(payload.inputs.map(input => input.id));
      for (const input of old) {
        if (!connected.has(input.id)) { input.state = 'disconnected'; inputs.delete(input.id); }
      }
      for (const device of payload.inputs) {
        const existing = inputs.get(device.id);
        if (existing) existing.name = device.name;
        else inputs.set(device.id, { ...device, type: 'input', state: 'connected', connection: 'open', onmidimessage: null });
      }
      if (pending) {
        clearTimeout(pending.timer); enabled = true; pending.resolve(access); pending = null;
      }
      access.onstatechange?.({ target: access });
    } else if (payload.type === 'messages' && enabled && !document.hidden) {
      const now = performance.now();
      for (const event of payload.events) {
        const input = inputs.get(event.id);
        if (input?.state === 'connected') input.onmidimessage?.({
          data: new Uint8Array(event.data),
          timeStamp: Math.max(0, now - Math.max(0, payload.now - event.at)),
        });
      }
    }
  } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) panic(); });
})();
