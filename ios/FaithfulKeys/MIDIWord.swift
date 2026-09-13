import Foundation

enum MIDIWord {
    static func length(_ type: Int) -> Int {
        // UMP message sizes, including reserved types, from the MIDI 2.0 format.
        [1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4][type & 15]
    }
    static func message(_ word: UInt32) -> [UInt8]? {
        guard word >> 28 == 2 else { return nil }
        let status = UInt8((word >> 16) & 255)
        let data1 = UInt8((word >> 8) & 255)
        let data2 = UInt8(word & 255)
        guard data1 < 128, data2 < 128 else { return nil }
        switch status & 0xf0 {
        case 0x80, 0x90: return [status, data1, data2]
        case 0xb0 where data1 == 120 || data1 == 123: return [status, data1, data2]
        default: return nil
        }
    }
}
