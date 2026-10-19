# Synthetic fixtures — schema 1

All test players, credentials, matches and timestamps are generated locally by
`clients::synthetic_page` and `synthetic_player`. These are synthetic examples,
not captured Tencent or Riot traffic. They contain no real PUUIDs or tokens.
The generator follows the source SUMMARY shape linked in `third-party/NOTICE.md`.
Fixed base time: 2026-10-16T00:00:00Z. Test IDs deliberately exceed JS safe integers.

Harness scenes: no-client, tencent (HN1), riot (NA alias → NA1), offline,
waiting, conflict (HN1 versus HN10), unknown. POST `/scenario` accepts bounded
status/delay controls with the process token; this route is never part of Tauri.
Each E2E creates a fresh temporary directory. A restart test explicitly reuses it.
Fixtures do not verify live endpoints or Windows credential discovery.

`icon.png` is a synthetic 1×1 PNG used only by the mock resource server.
`update-artifact.bin` is synthetic text, not an executable installer. Its signature
was generated locally by the Tauri signer with a test-only key, bound to version
9.9.9. Only the public key and signature are retained here; the private key is
outside the repository and is never used for production. SHA-256 values are in
`manifest.json` and checked by `bun run check`.
