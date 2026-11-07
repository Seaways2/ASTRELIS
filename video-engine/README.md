# Video runtime

Pinned Windows x64 mpv build, linked by https://mpv.io/installation/.
See runtime.json for the exact release and SHA256 (also compared against the GitHub asset digest).
mpv.exe is about 115 MiB uncompressed; the downloaded archive is about 32 MiB.
This is an independent process, controlled through a random local named pipe.
No system installation, registry changes, user mpv configuration, downloaded scripts or updater is used.

Restore binaries with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-video-engine.ps1`.
Only the executable and its D3D compiler dependency are needed at runtime; mpv.com is a development CLI shim.
Upstream copyright and GPL text are included. This does not resolve the project's existing public distribution licence gate.
Full mpv manual: https://mpv.io/manual/stable/.
