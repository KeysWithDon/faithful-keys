# Install Faithful Keys on your iPhone

This download contains the complete iPhone app project, including its interface,
offline piano/orchestra sounds and native USB/Bluetooth MIDI connection.
The sounds are already prepared. You do not need Node, pnpm or Terminal to use
this download.

1. Unzip **FaithfulKeys-iPhone-Xcode.zip** on a Mac with Xcode 16 or later.
2. Open **FaithfulKeys.xcodeproj**.
3. In **Xcode → Settings → Accounts**, sign in to your Apple Account.
4. Click the blue FaithfulKeys project icon. Select the **FaithfulKeys** app
   target, open **Signing & Capabilities**, and choose your **Team**. Leave
   automatic signing on. If the bundle identifier is unavailable, change it to
   a unique identifier such as `com.yourname.faithfulkeys`.
5. Connect your iPhone to the Mac, tap **Trust** if asked, and select your phone
   as Xcode's run destination. Enable **Settings → Privacy & Security →
   Developer Mode** on the phone if prompted, and follow its restart steps.
6. Click the **Run ▶** button. Xcode signs, installs and opens Faithful Keys.
7. In Faithful Keys, open **MIDI Setup**. Plug in a USB MIDI keyboard with the
   right adapter, or use **Pair Bluetooth keyboard**. Then tap **Connect MIDI
   keyboard** and select your keyboard.

The app needs iOS 16 or later. Landscape gives you a wider piano keyboard.
Use your iPhone speaker or wired headphones for responsive practice. A USB
keyboard may require a powered hub. Bluetooth MIDI pairing happens inside the
app's picker; Bluetooth headphones are a separate audio connection.

**Apple signing is required.** This ZIP cannot be installed by opening it in
Safari. A free Apple Personal Team supports testing on your own device, but
its seven-day provisioning must be renewed by reinstalling through Xcode.
TestFlight or App Store distribution requires an Apple Developer Program
membership and Apple signing/submission. No membership has been purchased and
this app has not been submitted to Apple.

Progress is saved inside the app, separately from Safari. Deleting the app
removes its local progress. Online song features require internet access.
Use the progression **Download** button and **Save to Files** to save a
progression, and **Import** to open one from Files.

The app's native build and simulator checks are automated. Real keyboard
pairing, device adapters and playing latency still need testing on your iPhone.

Apple's personal-device installation information:
https://developer.apple.com/help/account/basics/about-your-developer-account/
