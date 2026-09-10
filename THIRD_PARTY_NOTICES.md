# Third-party notices

Faithful Keys' Song Analyzer integration layer is original code. A production
deployment may be configured with separately obtained open-source vocal
separation and chord-recognition components. If it uses code or model artifacts
from Ultimate Vocal Remover or ChordMini, retain their applicable MIT copyright
and license notices and independently verify the license for every downloaded
model artifact and dataset. These components are not bundled with this GitHub
Pages repository or exposed in the product UI.

## Desktop edition

The desktop edition bundles the unchanged browser interface with Electron.
Electron and Chromium license files are included by the application packager;
additional installed dependency license texts are in the app's `licenses` folder.
Manrope, DM Mono, and Instrument Serif are bundled through Fontsource with their
SIL Open Font License texts. The website's existing icon is reused unchanged.

Splendid Grand Piano samples: public-domain recordings released by AKAI,
mapped and repaired by kinwie, converted to Ogg by the smpldsnds project.
Source and attribution: https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano
The desktop pack includes the original Ogg files without audio modification.

Sonatina Symphonic Orchestra: Mattias Westlund and contributors. The original
selected WAV recordings are included unchanged. Source:
https://github.com/peastman/sso (revision 64a66eda18c5cc1039a56c902d0555df56742300).
SSO license: Creative Commons Sampling Plus 1.0,
https://creativecommons.org/licenses/sampling+/1.0/.
French horn recordings also credit Mattias Westlund under Creative Commons
Attribution-ShareAlike 3.0, https://creativecommons.org/licenses/by-sa/3.0/.
The existing notice remains in `web/audio/sso/NOTICE.md`.
Each bundled audio file's source URL and SHA-256 digest are recorded in
`web/asset-manifest.json`.
