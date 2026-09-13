# Faithful Keys

Faithful Keys is a chord-progression maker, standards library, and piano voicing teacher.

## iPhone and iPad app

The repository includes a universal Capacitor iOS project for iPhone and iPad (iOS 15+).

```bash
pnpm install
pnpm ios:open
```

This builds the app's web interface for the native WebView, syncs it to `ios/`, and opens the Xcode project. In Xcode, select your Apple signing team, choose an iPhone or iPad simulator/device, and run the `App` target.

Before testing or releasing later changes, run:

```bash
pnpm ios:sync
```

The native target is configured for both iPhone and iPad and uses a playback audio session, so piano playback remains audible with the device's silent switch enabled. Building for a simulator, device, TestFlight, or the App Store requires the full Xcode app (not only Apple Command Line Tools) and the appropriate Apple developer signing access.
