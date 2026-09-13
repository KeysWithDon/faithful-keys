# Faithful Keys: getting it onto your iPhone

The remotely built **FaithfulKeys-iPhone-unsigned.ipa** contains the actual
iPhone application, native MIDI connection and bundled sounds. You do not need
a Mac to build it yourself. Apple signing remains necessary before installation.

## With only your phone

The standard route is TestFlight. This requires an Apple Developer Program
membership, an App Store Connect app record, distribution signing and upload.
Membership is normally US $99/year. Enrollment is available through Apple's
Developer app on iPhone. Enrollment and any payment must be completed by you.

The build tools have been updated to meet Apple's iOS 26 SDK minimum. The unsigned
IPA is not accepted directly by TestFlight; a signed distribution archive must
be exported and uploaded once your Apple account is configured. No signing
credentials are included in the download, and nothing has been sent to Apple.
Do not send Apple passwords or private signing keys in chat. Signing credentials
belong in a secure, access-controlled build configuration.

## With a Windows PC

Sideloadly can sign and install the unsigned IPA using your Apple account.
Download it from https://sideloadly.io/ and follow its installation instructions.
Connect and trust your iPhone, choose the IPA, and complete Apple authentication
on your own computer. A free account requires refreshing the installation every
seven days; the tool offers automatic refresh while the computer can reach the
phone. Device compatibility still needs to be confirmed on your hardware.

## Files

- **FaithfulKeys-iPhone-unsigned.ipa:** device app awaiting signing.
- **IPA-BUILD-INFO.json:** SDK, architecture, checksum and unsigned status.
- **FaithfulKeys-iPhone-Xcode.zip:** complete project with prepared resources.

Apple references:
- https://developer.apple.com/news/upcoming-requirements/
- https://developer.apple.com/programs/enroll/
- https://developer.apple.com/testflight/
