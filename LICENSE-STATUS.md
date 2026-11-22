# Auralis licence status

Status date: 2026-11-22

## Project licence

ASTRELIS (internal name Auralis) is free software, licensed under the GNU Affero General Public License, version 3 only (SPDX: `AGPL-3.0-only`). The full licence text is in `LICENSE`.

Copyright (C) 2026 Seaways.

The source code is published at https://github.com/Seaways2/ASTRELIS. Anyone who distributes a modified version, or lets users interact with one over a network, must offer the corresponding source under the same licence.

## Third-party components

1. **JUCE 8** (native plugin host): used under its AGPLv3 route, which matches the project licence. JUCE itself is not committed to this repository; it is placed in `native-host/third_party/JUCE` for local builds.
2. **FFmpeg and mpv** (bundled, unmodified executables): not committed to this repository. Installers that contain them are published with the source locations listed in `THIRD-PARTY-NOTICES.md` ("Corresponding source for bundled GPL executables"), plus an offer to provide a copy on request.
3. **ASIO SDK**: not used. Any future use needs its own licence and trademark review.

See `THIRD-PARTY-NOTICES.md` for the component inventory.

This file records an engineering decision. It is not legal advice.

Official references:

- GNU AGPL v3: https://www.gnu.org/licenses/agpl-3.0.html
- JUCE 8 licence: https://juce.com/legal/juce-8-licence/
- FFmpeg legal and licence considerations: https://ffmpeg.org/legal.html
- Steinberg ASIO SDK: https://www.steinberg.net/developers/asiosdk-open/
