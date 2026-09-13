import XCTest

final class AppUITests: XCTestCase {
    func testBundledAppAndNativeMIDI() {
        let app = XCUIApplication()
        app.launch()
        let midi = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS 'MIDI Setup'")).firstMatch
        XCTAssertTrue(midi.waitForExistence(timeout: 40), "Bundled React app should launch without a web server")
        midi.tap()
        XCTAssertTrue(app.webViews.buttons["Pair Bluetooth keyboard"].waitForExistence(timeout: 5))
        app.webViews.buttons["Connect MIDI keyboard"].tap()
        XCTAssertTrue(app.webViews.buttons["Disable MIDI"].waitForExistence(timeout: 10), "The CoreMIDI bridge should enable even with no hardware attached")
        app.webViews.buttons["Disable MIDI"].tap()
        XCTAssertTrue(app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS 'MIDI Setup' AND label CONTAINS 'Disabled'")).firstMatch.waitForExistence(timeout: 5))
        app.webViews.buttons["Done"].tap()
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(midi.waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .portrait
    }
}
