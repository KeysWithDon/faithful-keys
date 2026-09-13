import XCTest
@testable import FaithfulKeys

final class MIDIWordTests: XCTestCase {
    func testNoteMessagesAndChannel() {
        XCTAssertEqual(MIDIWord.message(0x20923c64), [0x92, 60, 100])
        XCTAssertEqual(MIDIWord.message(0x20823c40), [0x82, 60, 64])
        XCTAssertEqual(MIDIWord.message(0x20903c00), [0x90, 60, 0])
    }
    func testFilteringAndPanic() {
        XCTAssertEqual(MIDIWord.message(0x20b07b00), [0xb0, 123, 0])
        XCTAssertEqual(MIDIWord.message(0x20b17800), [0xb1, 120, 0])
        XCTAssertNil(MIDIWord.message(0x30b07b00))
        XCTAssertNil(MIDIWord.message(0x20b0407f))
        XCTAssertNil(MIDIWord.message(0x20908001))
        XCTAssertNil(MIDIWord.message(0x20903cff))
        XCTAssertEqual(MIDIWord.length(3), 2)
        XCTAssertEqual(MIDIWord.length(5), 4)
    }
}
