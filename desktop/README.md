# Faithful Keys desktop builds

The Electron app loads the Vite desktop build from a secure custom protocol.
It does not depend on GitHub Pages being online. Browser source behavior is
unchanged unless `VITE_DESKTOP` is set by `vite.desktop.config.ts`.

## Build on your computer

Use Node 24 and pnpm 11.19.0. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test:desktop
pnpm build:desktop
pnpm desktop:assets
pnpm desktop:stage
# On macOS (choose arm64 or x64 to match the Mac):
pnpm desktop:package --mac --arm64
# On Windows:
pnpm desktop:package --win --x64
```

`desktop:assets` downloads the original audio at immutable source revisions.
Staging checks every audio file's SHA-256 digest before copying it into the app.
License texts, local fonts, a setup guide, and the existing icon are included.
Installers go into `release/`. For development, run `pnpm exec install-electron`
once, then `pnpm desktop:start` after staging.

Public browser configuration used by Pages must also be supplied at desktop
build time for online features. Never bundle a service-role key or private secret.

## Free release workflow

`desktop.yml` uses only standard GitHub-hosted runners and refuses to run if
the repository is private. It uses no paid signing service, Actions cache, or
Actions artifact storage. Installers are uploaded directly to a draft GitHub
Release, then published only after Windows, Intel Mac and Apple-silicon Mac
native builds and smoke checks succeed. Bump the root package version before
making a subsequent release. An already published release is never overwritten.

If a build fails, the release stays draft. Fix the source and rerun; draft
assets for the same version can be replaced by the successful build.

## Validation and limits

`test:desktop` checks local-file containment, trusted-origin MIDI permissions,
SysEx denial, and external URL restrictions. `smoke:desktop <executable>`
launches the packaged app through Playwright on its native OS, blocks internet
requests, checks MIDI permission handling, Web Audio and decoded bundled samples,
local fonts, actual Guided Mode persistence across restarts, Explore Mode,
Ear Training and the bundled guide.

No physical MIDI controller is available on the hosted build machines. Test USB,
OS-paired Bluetooth, note-on/off, sustain and input latency on actual hardware.
Mac packages are ad-hoc signed, not notarized; Windows packages are unsigned.
The app keeps the runtime's minimum OS requirement; it does not lower the
minimum version in the bundle to claim support on unsupported older systems.

Progress lives in the stable `Faithful Keys` user-data folder and persistent
`faithful-keys://app` origin. No broad Node, Electron or filesystem API is exposed
to the renderer. The desktop has its own progress, separate from browser storage.
