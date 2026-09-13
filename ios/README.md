# Faithful Keys for iPhone and iPad

This is a native iOS app containing the existing Faithful Keys interface,
lessons, keyboards, local progress, fonts and sounds. CoreMIDI supplies USB and
Bluetooth MIDI input directly to the existing MIDI lesson engine. It does not
require Safari's unsupported Web MIDI API or a second computer during practice.

Requires iOS 16 or later. Rotate to landscape for a wider keyboard. The native
view stays inside the screen's safe area. Sounds use AAC/WAV for compatibility
with older iOS releases. Internet access is still required for online songs,
YouTube and services; the core lessons and practice sounds are bundled.

## Build and install on your iPhone

On a Mac with Xcode 16 or later, Node 24, pnpm 11.19.0 and ffmpeg:

```sh
pnpm install --frozen-lockfile
pnpm test:ios
pnpm build:ios
pnpm desktop:assets
pnpm ios:prepare
open ios/FaithfulKeys.xcodeproj
```

1. In Xcode, open Settings → Accounts and sign in to your Apple Account.
2. Select the FaithfulKeys project and app target. Under Signing & Capabilities,
   select your team. Change the bundle identifier if Xcode asks for a unique one.
3. Connect and trust your iPhone, select it as the run destination and enable
   Developer Mode if the phone requests it. Click Run.
4. Open **MIDI Setup**. Connect USB through the adapter appropriate to your
   iPhone, or tap **Pair Bluetooth keyboard** and connect your MIDI device.
   Then tap **Connect MIDI keyboard** and select the keyboard.

A free Apple Personal Team can install for personal testing, but its provisioning
expires after seven days and requires rebuilding/reinstalling. TestFlight and
App Store distribution require Apple Developer Program membership, signing and
App Store Connect setup. An unsigned build is not an installable iPhone download.
No Apple subscription or paid service is purchased by this project.

Apple references:
- https://developer.apple.com/help/account/basics/about-your-developer-account/
- https://developer.apple.com/documentation/coreaudiokit/cabtmidicentralviewcontroller

Use the iPhone speaker or wired headphones for responsive practice. Bluetooth
MIDI and Bluetooth audio are different; wireless audio can add noticeable delay.
USB keyboards may need a powered hub. Pair Bluetooth MIDI inside the app's
picker, rather than expecting it to appear in the normal audio pairing list.

## Progress, files and privacy

App progress is stored in its persistent WKWebView data store. It is separate
from Safari and the desktop app; deleting the app removes app-local data. Saved
progressions can be imported through Files and exported with the native share
sheet's Save to Files action. Cancelling a save is not reported as success.

The native layer requests Bluetooth access only for MIDI pairing and does not
request microphone, location or contacts. It exposes only input MIDI, Bluetooth
pairing and bounded JSON progression exports to the bundled main frame. External
links open outside the privileged view. No MIDI data is uploaded by the bridge.
The native privacy manifest describes native API use; review the existing online
services and complete App Store privacy answers before store submission.

## Validation

```sh
pnpm test:ios
pnpm typecheck
xcodebuild -project ios/FaithfulKeys.xcodeproj -scheme FaithfulKeys \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
# Choose an installed simulator name from `xcrun simctl list devices available`:
xcodebuild -project ios/FaithfulKeys.xcodeproj -scheme FaithfulKeys \
  -destination 'platform=iOS Simulator,name=iPhone 16' test
```

The iPhone workflow builds for a physical iPhone without signing, then runs
native packet tests and a simulator launch/MIDI connection UI test. JavaScript
tests cover trusted origins, SysEx denial, message timing, device changes,
disconnect races, background suppression and file-save results.

Before distributing, test on real hardware: USB/Bluetooth note-on and release,
chords, repeated notes, changing devices, unplugging a held key, screen locking,
audio interruptions, lesson scoring, file import/export, offline sound loading,
and retained progress after relaunch. Hardware latency and Bluetooth pairing
cannot be verified with a simulator. Sustain-controller behavior remains that
of the existing lesson engine; this bridge does not add pedal interpretation.

The checked-in Xcode project can be regenerated with
`python3 ios/generate-project.py`. Web and audio build products are intentionally
not committed. No signing keys or Apple credentials belong in the repository.
