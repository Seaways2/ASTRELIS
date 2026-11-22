# Third-party dependency record

## Corresponding source for bundled GPL executables

ASTRELIS installers published at https://github.com/Seaways2/ASTRELIS/releases ship two unmodified third-party GPL executables. Their corresponding source is available from these places, and will stay listed here for every published installer:

- **FFmpeg** `ffmpeg.exe`, build `2025-11-12-git-6cdd2cbe32-full_build-www.gyan.dev` (GPLv3, `--enable-gpl --enable-version3`).
  - FFmpeg source at that commit: https://github.com/FFmpeg/FFmpeg/tree/6cdd2cbe32
  - Build provider and its build notes / library list: https://www.gyan.dev/ffmpeg/builds/ and https://github.com/GyanD/codexffmpeg/releases
  - Licence: https://ffmpeg.org/legal.html
- **mpv** `mpv.exe`, `mpv v0.41.0-1087-ge470f8986` (GPLv2 or later), from https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260928
  - mpv source at that commit: https://github.com/mpv-player/mpv/tree/e470f8986e
  - Build recipe that fetches and builds every bundled library: https://github.com/shinchiro/mpv-winbuild-cmake/tree/20260928
  - Upstream copyright and GPL text are shipped next to the binary (`video-engine/LICENSE-Copyright`, `video-engine/LICENSE.GPL`).

If any of these links stop working, open an issue at https://github.com/Seaways2/ASTRELIS/issues and a copy of the source will be provided.

Status date: 2026-08-11  
Status: engineering inventory; final legal notices remain a release gate

## JUCE

- Bundled version: 8.0.8.
- Source location: `native-host/third_party/JUCE`.
- File count used for deterministic inventory: 4,244.
- Deterministic tree SHA-256: `732140FD8EE6F8039E28BFED39E746E238B802CC64449DFDEBDFE8358854C4C3`.
- Bundled licence text: `native-host/third_party/JUCE/LICENSE.md`.
- Official project: https://github.com/juce-framework/JUCE
- Official JUCE 8 licence: https://juce.com/legal/juce-8-licence/

JUCE 8.0.15 is the current stable JUCE 8 tag observed during Phase 0B. Auralis remains pinned to 8.0.8 for the 2.3.5 baseline because 8.0.8 is the version used by the verified 2.3.4 audio path. A point-version upgrade must be a separate, independently tested change and must not be mixed with the Native Output Engine transaction implementation.

## FFmpeg

- File: `ffmpeg/ffmpeg.exe`.
- Reported build: `2025-11-12-git-6cdd2cbe32-full_build-www.gyan.dev`.
- SHA-256: `A95427674D8E3C44E1BD3AC8C6D847E57B4DE5EAC79C79F44C03D6FF1C6D6A4E`.
- The executable reports `--enable-gpl`, `--enable-version3`, static build, libx264, libx265 and other optional libraries.
- Official FFmpeg legal guidance: https://ffmpeg.org/legal.html

The current repository does not contain the exact corresponding FFmpeg source archive, build script or complete licence bundle. Public installer distribution remains blocked until the project owner chooses and documents a compliant FFmpeg distribution strategy. This inventory does not claim that the Auralis application itself is or is not subject to any particular licence; that determination is outside this engineering record.

## Node / Electron dependencies

- Package manager lock: `pnpm-lock.yaml`.
- Lock SHA-256 at the 2.6.3 pre-review baseline: `B5C1ABB003F6A222228FC4D830A8CC0CB91BB1D3DA4E05572156AE1C0D1DE5CF`.
- Production dependency audit at planning time reported no known vulnerabilities.
- Exact resolved package versions and integrity values are recorded in `pnpm-lock.yaml`.

Resolved production packages at the 2.6.3 pre-review baseline:

- `@neteasecloudmusicapienhanced/api` 4.36.2 — MIT.
- `fuse.js` 7.5.0 — Apache-2.0.
- `lucide-react` 0.468.0 — ISC.
- `music-metadata` 11.14.0 — MIT.
- `zustand` 5.0.14 — MIT.

The complete production graph contains 203 package records across MIT, ISC,
Apache-2.0, BSD variants, BlueOak-1.0.0, 0BSD, LGPL-3.0-only and one dual-choice
BSD/GPL declaration. In particular, `@unblockneteasemusic/server` 0.28.0 is a
transitive LGPL-3.0-only dependency. Its published package includes a public
test TLS certificate/private-key pair used by that dependency at runtime. It
is not an ASTRELIS user credential, but it remains part of the public release
licence and security review gate and was not removed by an unsafe static guess.

Before RC, generate a machine-readable production dependency licence inventory from the lockfile and reconcile it with this notice.

## CMake build tool

- Bootstrap pin: CMake 3.31.6 Python wheel.
- Installed under ignored workspace directory `.tools/cmake` by `scripts/bootstrap-native-tools.ps1`.
- CMake is a development tool and is not copied into the Auralis installer by the current package configuration.

## ASIO

- `JUCE_ASIO` is disabled in the 2.3.5 baseline.
- No ASIO SDK or ASIO binary is intentionally included in the 2.3.5 public package path.
- ASIO remains a conditional later phase and is not a WASAPI release dependency.
# Video preview runtime (2.14.2)

The independent video process uses mpv v0.41.0-1087-ge470f8986 from the Windows builds linked at https://mpv.io/installation/.
Exact provenance and hashes: video-engine/runtime.json. Upstream copyright and GPL text: video-engine/LICENSE-Copyright and video-engine/LICENSE.GPL.
This binary also contains FFmpeg/libplacebo and other upstream dependencies. Public redistribution remains subject to the unresolved project release gate in LICENSE-STATUS.md; these notices alone do not establish compliance.


## OpenCC JavaScript (2.17.4 addition)

- opencc-js 1.4.2, MIT AND Apache-2.0.
- Used locally to compare simplified and traditional Chinese music metadata.
- Project: https://github.com/nk2028/opencc-js
- Full licence and data attribution texts are bundled in `resources/licenses/opencc-js`.
