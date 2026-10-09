/**
 * Direct Web Bluetooth support for Bluetooth Low Energy MIDI 1.0.
 * A browser can only display the OS device chooser after a user gesture.
 * This is not a generic Bluetooth scanner: it filters for the BLE-MIDI service.
 */
export const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const BLE_MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';

type BleCharacteristic = {
  value?: DataView | null;
  startNotifications(): Promise<BleCharacteristic>;
  addEventListener(type: 'characteristicvaluechanged', listener: EventListener): void;
  removeEventListener(type: 'characteristicvaluechanged', listener: EventListener): void;
};
type BleGatt = {
  connected: boolean;
  connect(): Promise<BleGatt>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<{getCharacteristic(uuid: string): Promise<BleCharacteristic>}>;
};
type BleDevice = {
  id: string;
  name?: string;
  gatt?: BleGatt;
  addEventListener(type: 'gattserverdisconnected', listener: EventListener): void;
  removeEventListener(type: 'gattserverdisconnected', listener: EventListener): void;
};
type BleAdapter = {
  requestDevice(options: {filters: {services: string[]}[]}): Promise<BleDevice>;
};

export type BleMidiConnection = {
  id: string;
  name: string;
  disconnect(): void;
};

export function webBluetoothMidiSupported(): boolean {
  return typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & {bluetooth?: BleAdapter}).bluetooth?.requestDevice === 'function';
}

/** Decode channel voice messages from a BLE-MIDI packet, including running status.
 * Timestamp bytes are transport metadata, not MIDI status bytes. SysEx and
 * system messages are intentionally ignored; lessons need notes and CC panic.
 */
export function decodeBleMidi(packet: ArrayLike<number>): number[][] {
  const result: number[][] = [];
  if (packet.length < 3 || (packet[0] & 0x80) === 0) return result;
  let index = 1;
  let running = 0;
  while (index < packet.length) {
    // Each new explicit status is preceded by a timestamp low byte. A running
    // status message can omit the timestamp if it uses the preceding one.
    if (packet[index] & 0x80) {
      index++;
      if (index >= packet.length) break;
      if (packet[index] & 0x80) {
        const status = packet[index++];
        if (status >= 0xf8) continue; // Real-time; no effect on running status.
        if (status >= 0xf0) { running = 0; continue; }
        running = status;
      } else if (!running) {
        continue;
      }
    }
    if (!running) { index++; continue; }
    const command = running & 0xf0;
    const count = command === 0xc0 || command === 0xd0 ? 1 : 2;
    if (index + count > packet.length) break;
    // A timestamp or status interrupting a partial message is not MIDI data.
    if (packet[index] & 0x80 || (count === 2 && packet[index + 1] & 0x80)) break;
    const first = packet[index++];
    const second = count === 2 ? packet[index++] : 0;
    if (command === 0x80 || command === 0x90 || command === 0xb0)
      result.push([running, first, second]);
  }
  return result;
}

/** Call directly in an onClick handler: requestDevice needs user activation. */
export async function requestBluetoothMidi(
  onMessage: (message: number[], at: number) => void,
  onDisconnect: () => void,
): Promise<BleMidiConnection> {
  const adapter = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & {bluetooth?: BleAdapter}).bluetooth;
  if (!adapter) throw new Error('This browser does not support Bluetooth MIDI scanning.');
  const device = await adapter.requestDevice({filters: [{services: [BLE_MIDI_SERVICE]}]});
  if (!device.gatt) throw new Error('The selected device does not offer a Bluetooth MIDI connection.');

  let characteristic: BleCharacteristic | null = null;
  let closed = false;
  const onNotification: EventListener = () => {
    const value = characteristic?.value;
    if (!value || closed) return;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const at = performance.now();
    for (const message of decodeBleMidi(bytes)) onMessage(message, at);
  };
  const detach = () => {
    if (closed) return;
    closed = true;
    characteristic?.removeEventListener('characteristicvaluechanged', onNotification);
    device.removeEventListener('gattserverdisconnected', onLost);
  };
  const onLost: EventListener = () => {
    detach();
    onDisconnect();
  };
  try {
    const gatt = await device.gatt.connect();
    const service = await gatt.getPrimaryService(BLE_MIDI_SERVICE);
    characteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC);
    characteristic.addEventListener('characteristicvaluechanged', onNotification);
    device.addEventListener('gattserverdisconnected', onLost);
    await characteristic.startNotifications();
  } catch (error) {
    detach();
    if (device.gatt.connected) device.gatt.disconnect();
    throw error;
  }

  return {
    id: 'bluetooth:' + device.id,
    name: device.name || 'Bluetooth MIDI keyboard',
    disconnect() {
      detach();
      if (device.gatt?.connected) device.gatt.disconnect();
    },
  };
}
