import Foundation
import CoreMIDI
import AVFAudio

/// CoreMIDI converts hardware MIDI 1/2 streams to MIDI 1.0 UMP packets for the
/// existing lesson engine. Only notes and all-notes-off controls cross to JS.
final class MIDIService {
    var send: (([String: Any]) -> Void)?
    private var client = MIDIClientRef()
    private var port = MIDIPortRef()
    private var sources = Set<MIDIEndpointRef>()
    private var requestID = 0
    private var epoch = 0
    private var wantsConnection = false

    func start(id: Int) {
        stop()
        wantsConnection = true
        requestID = id
        open()
    }

    private func open() {
        let currentEpoch = epoch
        var result = MIDIClientCreateWithBlock("Faithful Keys" as CFString, &client) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.epoch == currentEpoch else { return }
                self.refresh()
            }
        }
        guard result == noErr else { fail(result); return }
        result = MIDIInputPortCreateWithProtocol(client, "Keyboard input" as CFString, MIDIProtocolID(rawValue: 1)!, &port) { [weak self] list, context in
            guard let context else { return }
            let endpoint = String(UInt(bitPattern: context))
            var events = [[String: Any]]()
            let offset = MemoryLayout<MIDIEventList>.offset(of: \.packet)!
            var packet = UnsafeRawPointer(list).advanced(by: offset).assumingMemoryBound(to: MIDIEventPacket.self)
            for _ in 0..<list.pointee.numPackets {
                let timestamp = packet.pointee.timeStamp
                let at = timestamp == 0 ? ProcessInfo.processInfo.systemUptime * 1000 : AVAudioTime.seconds(forHostTime: timestamp) * 1000
                let wordOffset = MemoryLayout<MIDIEventPacket>.offset(of: \.words)!
                let words = UnsafeRawPointer(packet).advanced(by: wordOffset).assumingMemoryBound(to: UInt32.self)
                var index = 0
                while index < Int(packet.pointee.wordCount) {
                    let word = words[index]
                    let type = Int(word >> 28)
                    if type == 2, let data = MIDIWord.message(word) {
                        events.append(["id": endpoint, "data": data, "at": at])
                    }
                    index += MIDIWord.length(type)
                }
                packet = UnsafePointer(MIDIEventPacketNext(packet))
            }
            guard !events.isEmpty else { return }
            let batch = events
            DispatchQueue.main.async {
                guard let self, self.epoch == currentEpoch, self.wantsConnection, self.port != 0 else { return }
                self.send?(["type": "messages", "id": self.requestID, "now": ProcessInfo.processInfo.systemUptime * 1000, "events": batch])
            }
        }
        guard result == noErr else { fail(result); return }
        refresh()
    }

    private func fail(_ status: OSStatus) {
        let id = requestID
        stop()
        send?(["type": "error", "id": id, "message": "Could not open MIDI (\(status)). Try connecting again."])
    }

    private func refresh() {
        guard port != 0 else { return }
        let available = Set((0..<MIDIGetNumberOfSources()).map { MIDIGetSource($0) }.filter { $0 != 0 })
        for source in sources.subtracting(available) { MIDIPortDisconnectSource(port, source) }
        sources.formIntersection(available)
        for source in available.subtracting(sources) {
            if MIDIPortConnectSource(port, source, UnsafeMutableRawPointer(bitPattern: Int(source))) == noErr { sources.insert(source) }
        }
        let devices: [[String: String]] = sources.sorted().map { source in
            var name: Unmanaged<CFString>?
            MIDIObjectGetStringProperty(source, kMIDIPropertyDisplayName, &name)
            return ["id": String(source), "name": name?.takeRetainedValue() as String? ?? "MIDI keyboard"]
        }
        send?(["type": "devices", "id": requestID, "inputs": devices])
    }

    private func close() {
        epoch += 1
        if port != 0 { MIDIPortDispose(port); port = 0 }
        if client != 0 { MIDIClientDispose(client); client = 0 }
        sources.removeAll()
    }
    func stop() { wantsConnection = false; close() }
    func suspend() { send?(["type": "panic"]); close() }
    func resume() { if wantsConnection && port == 0 { open() } }
    deinit { if port != 0 { MIDIPortDispose(port) }; if client != 0 { MIDIClientDispose(client) } }
}
