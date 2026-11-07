# Library Level 0 fixtures

These fixtures freeze the Auralis 2.3.16 music-library inputs before the repository upgrade.

- empty: a valid library with no tracks.
- normal-v1: the legacy tracks/folders JSON shape and a deterministic 128-track profile.
- damaged-json: syntactically invalid JSON.
- truncated-json: a write interrupted before the document was complete.
- duplicate-albums: the same album title used by different artists.
- missing-metadata: persisted localized fallback strings from the legacy scanner.
- moved-files: the same logical audio file at two paths, currently producing two path identities.
- partial-root: a previous complete root and an incomplete observation.
- legacy-localstorage: legacy favorites and removed library keys.

Scale data is generated in memory by fixtureFactory.cjs. Profiles are 128 tracks, 15,388 tracks, and 100,000 tracks. Generated fixtures contain synthetic paths only and never copy the user's private music metadata.
