# Platform Release Manifest

Truth status: `TESTED_LOCAL`

The production release manifest is an exact-artifact gate, not a manually edited evidence note. The API release tooling inventories every UI migration from 64 through 136 and every API timestamped migration, computes SHA-256 digests, binds them to the exact repository commits, records the transactional lock profile and rollback strategy, and signs the canonical payload with Ed25519.

The signer private key must be provided through a protected file mounted by the authorized release workflow. It is never committed, accepted through a browser request, or printed. Verification requires the independently trusted public key and rejects changed migration bytes, changed source commits, dirty production source trees, missing immutable build artifacts, missing deployment release IDs, a non-`LIVE_EXTERNAL` truth label, or an invalid signature.

The release workflow uses:

1. `npm run release:manifest:prepare` after all three exact artifacts are built.
2. `npm run release:manifest:sign` in the authorized signing environment.
3. `npm run release:manifest:verify` before database application and again before immutable promotion.

Required inputs are `PLATFORM_RELEASE_ID`, `PLATFORM_RELEASE_EVIDENCE_AT`, `PLATFORM_RELEASE_TRUTH_STATUS`, `LUZIONE_UI_RELEASE_ROOT`, `SULTAN_OS_RELEASE_ROOT`, each component's artifact path and deployment release ID, and the signing/trust key file and key-ID variables named by the scripts. Production certification remains blocked until the real artifact hashes, deployment IDs, `LIVE_EXTERNAL` evidence, and authorized signature are present; placeholders or unsigned manifests cannot pass.
