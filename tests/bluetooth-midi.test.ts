import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBleMidi,encodeBleMidi,requestBluetoothMidi, BLE_MIDI_SERVICE, BLE_MIDI_CHARACTERISTIC } from '../app/midi/bluetooth.ts';
import {MidiManager} from '../app/midi/manager.ts';

function adapter(writable=true){
  const packets:Uint8Array[]=[];let fail=false;let simultaneous=0,maxSimultaneous=0;
  const events=new Map<string,EventListener>();
  const characteristic={
    properties:{writeWithoutResponse:writable,write:false},value:null as DataView|null,
    async writeValueWithoutResponse(data:Uint8Array){
      simultaneous++;maxSimultaneous=Math.max(maxSimultaneous,simultaneous);
      try{await Promise.resolve();if(fail)throw new Error('write failed');packets.push(Uint8Array.from(data));}finally{simultaneous--;}
    },
    async startNotifications(){return characteristic;},
    addEventListener(type:string,listener:EventListener){events.set(type,listener);},
    removeEventListener(type:string){events.delete(type);},
  };
  const deviceEvents=new Map<string,EventListener>();
  const gatt={connected:false,async connect(){gatt.connected=true;return gatt;},disconnect(){gatt.connected=false;},async getPrimaryService(){return {async getCharacteristic(){return characteristic;}};}};
  const device={id:'test-ble',name:'Piano adapter',gatt,addEventListener(type:string,listener:EventListener){deviceEvents.set(type,listener);},removeEventListener(type:string){deviceEvents.delete(type);}};
  return {
    transport:{async requestDevice(){return device;}},packets,characteristic,
    setFail(value:boolean){fail=value;},get maxSimultaneous(){return maxSimultaneous;},
    receive(data:number[]){const bytes=encodeBleMidi(data)[0];characteristic.value=new DataView(bytes.buffer as ArrayBuffer);events.get('characteristicvaluechanged')?.(new Event('characteristicvaluechanged'));},
    disconnect(){gatt.connected=false;deviceEvents.get('gattserverdisconnected')?.(new Event('gattserverdisconnected'));},
  };
}

test('uses standard Bluetooth LE MIDI service and characteristic', () => {
  assert.equal(BLE_MIDI_SERVICE, '03b80e5a-ede8-4b33-a751-6ce34ec4c700');
  assert.equal(BLE_MIDI_CHARACTERISTIC, '7772e5db-3868-4112-a1a9-f2669d106bf3');
});

test('decodes BLE MIDI note on and note off messages', () => {
  assert.deepEqual(decodeBleMidi([0x80, 0x80, 0x90, 60, 100]), [[0x90, 60, 100]]);
  assert.deepEqual(decodeBleMidi([0x80, 0x81, 0x80, 60, 0]), [[0x80, 60, 0]]);
});

test('decodes multiple timestamped messages in one BLE packet', () => {
  const packet = [0x80, 0x80, 0x90, 60, 120, 0x81, 0x90, 64, 90];
  assert.deepEqual(decodeBleMidi(packet), [[0x90, 60, 120], [0x90, 64, 90]]);
});

test('decodes running-status messages with or without repeated timestamp', () => {
  assert.deepEqual(
    decodeBleMidi([0x80, 0x80, 0x90, 60, 100, 62, 80, 0x81, 64, 72]),
    [[0x90, 60, 100], [0x90, 62, 80], [0x90, 64, 72]],
  );
});

test('preserves channel bytes and all-notes-off controllers', () => {
  assert.deepEqual(decodeBleMidi([0x80, 0x80, 0x92, 72, 100, 0x80, 0xb2, 123, 0]),
    [[0x92, 72, 100], [0xb2, 123, 0]]);
});

test('a Bluetooth packet preserves pedal-down, notes and pedal-up in order',()=>{
  assert.deepEqual(decodeBleMidi([0x80,0x80,0xb2,64,127,0x81,0x92,60,100,0x82,0x82,60,0,0x83,0xb2,64,0]),
    [[0xb2,64,127],[0x92,60,100],[0x82,60,0],[0xb2,64,0]]);
});

test('does not send malformed packets or system messages into note evaluation', () => {
  assert.deepEqual(decodeBleMidi([0, 0x80, 0x90, 60, 100]), []);
  assert.deepEqual(decodeBleMidi([0x80, 0x80, 0xf0, 1, 2, 0x81, 0xf7]), []);
  assert.deepEqual(decodeBleMidi([0x80, 0x80, 0x90, 60]), []);
});

test('ten-note BLE chords have timestamps, preserve channel and fit the default MTU',()=>{
  const messages=Array.from({length:10},(_,i)=>[0x95,36+i*3,90]).flat();
  for(const timestamp of [0,127,128,8191,8192]){
    const packets=encodeBleMidi(messages,timestamp);
    assert.equal(packets.length,3);assert.ok(packets.every(packet=>packet.length<=20));
    assert.deepEqual(packets.flatMap(packet=>decodeBleMidi(packet)),Array.from({length:10},(_,i)=>[0x95,36+i*3,90]));
    assert.equal(packets[0][0],0x80|(((timestamp&8191)>>7)&63));
    assert.equal(packets[0][1],0x80|(timestamp&127));
  }
  for(const bad of [[],[0x90,60],[0x90,128,100],[0xf0,1,2]])assert.throws(()=>encodeBleMidi(bad));
});

test('direct Bluetooth sends chord packets in order without overlapping GATT writes',async()=>{
  const fake=adapter();const received:number[][]=[];
  const connection=await requestBluetoothMidi(data=>received.push(data),()=>{},fake.transport);
  assert.equal(connection.canSend,true);assert.equal(connection.state,'connected');
  const on=Array.from({length:10},(_,i)=>[0x92,48+i,100]).flat();
  const off=Array.from({length:10},(_,i)=>[0x82,48+i,0]).flat();
  await Promise.all([connection.send(on),connection.send(off)]);
  assert.equal(fake.maxSimultaneous,1);
  assert.deepEqual(fake.packets.flatMap(packet=>decodeBleMidi(packet)),[...Array.from({length:10},(_,i)=>[0x92,48+i,100]),...Array.from({length:10},(_,i)=>[0x82,48+i,0])]);
  fake.receive([0x90,72,100]);assert.deepEqual(received,[[0x90,72,100]]);
  connection.disconnect();assert.equal(connection.state,'disconnected');
  await assert.rejects(connection.send([0x90,60,100]),/disconnected/);
});

test('Bluetooth input-only devices cannot be selected as playback outputs',async()=>{
  const fake=adapter(false),midi=new MidiManager();
  await midi.findBluetooth((onMessage,onDisconnect)=>requestBluetoothMidi(onMessage,onDisconnect,fake.transport));
  assert.equal(midi.getSnapshot().status,'Connected');assert.equal(midi.getSnapshot().bluetoothCanSend,false);
  assert.deepEqual(midi.getSnapshot().outputs,[]);
  midi.selectOutput('bluetooth:test-ble');assert.equal(midi.getSnapshot().selectedOutput,'');
  fake.receive([0x90,60,100]);assert.deepEqual(midi.getSnapshot().pressed,[60]);
  midi.disable();
});

test('a writable direct Bluetooth device is exposed as a separate output and write errors reach the user',async()=>{
  const fake=adapter(),midi=new MidiManager();
  await midi.findBluetooth((onMessage,onDisconnect)=>requestBluetoothMidi(onMessage,onDisconnect,fake.transport));
  assert.deepEqual(midi.getSnapshot().outputs,[{id:'bluetooth:test-ble',name:'Piano adapter (Bluetooth MIDI)'}]);
  assert.equal(midi.getSnapshot().selectedOutput,'');
  midi.selectOutput('bluetooth:test-ble');fake.setFail(true);
  await assert.rejects(midi.playOutputChord([60,64,67]),/Could not send MIDI/);
  assert.equal(midi.getSnapshot().outputPlaying,false);assert.match(midi.getSnapshot().outputMessage,/Could not send MIDI/);
  fake.setFail(false);await midi.silenceOutput();
  assert.ok(fake.packets.flatMap(packet=>decodeBleMidi(packet)).some(message=>message[0]===0xb0&&message[1]===123));
  fake.disconnect();assert.deepEqual(midi.getSnapshot().outputs,[]);assert.equal(midi.getSnapshot().bluetoothCanSend,false);
});

test('clearing the BLE queue cancels unsent notes and leaves the subsequent note-offs writable',async()=>{
  const fake=adapter();const connection=await requestBluetoothMidi(()=>{},()=>{},fake.transport);
  const pending=connection.send(Array.from({length:10},(_,i)=>[0x90,60+i,90]).flat());
  const cancelled=assert.rejects(pending,/cancelled/);
  connection.clear();
  await connection.send([0x80,60,0,0x80,64,0]);await cancelled;
  assert.deepEqual(fake.packets.flatMap(packet=>decodeBleMidi(packet)),[[0x80,60,0],[0x80,64,0]]);
  connection.disconnect();
});

test('the test chord sends real BLE note-ons and note-offs on the selected piano channel',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  const fake=adapter(),midi=new MidiManager();
  await midi.findBluetooth((onMessage,onDisconnect)=>requestBluetoothMidi(onMessage,onDisconnect,fake.transport));
  midi.selectOutput('bluetooth:test-ble');midi.setOutputChannel(5);
  const finished=midi.sendTestChord();
  await flush();assert.equal(midi.getSnapshot().outputPlaying,true);
  assert.deepEqual(fake.packets.flatMap(packet=>decodeBleMidi(packet)),[[0x94,60,83],[0x94,64,83],[0x94,67,83]]);
  fake.receive([0x90,72,100]);assert.deepEqual(midi.getSnapshot().pressed,[72]);
  t.mock.timers.tick(750);await flush();t.mock.timers.tick(100);await finished;
  assert.deepEqual(fake.packets.flatMap(packet=>decodeBleMidi(packet)).slice(3),[[0x84,60,0],[0x84,64,0],[0x84,67,0]]);
  assert.equal(midi.getSnapshot().outputPlaying,false);assert.match(midi.getSnapshot().outputMessage,/Test chord sent.*channel 5/);
  midi.disable();
});
