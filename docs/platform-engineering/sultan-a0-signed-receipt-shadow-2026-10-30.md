# Default-OFF Luzione API A0 signed receipt emission

- date: 2026-10-30
- repo_baseline: CIBOTFLOW/Luzione-API main e67751d5c348c03bed3b3c1d687c4247d715d511
- dependency: Sultan-OS main 2993924f5b8079ef82e81de73a46f4013c5b10d5
- mode: SHADOW; feature OFF unless explicit environment opt-in; no additional paid service.
- problem: A0 tool invocation returned only toolResult, while Sultan's HMAC gate requires a signed manifest/result envelope.
- change: After existing authenticated Stage 5-gated A0 read, the route may return a freshly generated manifest and canonical HMAC-SHA256 envelope. The signer requires the exact OIDC Sultan workload, A0 READY result, bounded evidence age, exact case version, source binding, 32–128 byte dedicated key, and 4-minute expiry. No signing key is committed or logged.
- activation: LUZIONE_SULTAN_A0_RECEIPT_SIGNING_ENABLED=true, LUZIONE_SULTAN_A0_RECEIPT_KEY_ID and LUZIONE_SULTAN_A0_RECEIPT_HMAC_KEY_B64 are NOT set by this PR. Do not enable before deployment key custody, producer/consumer identity, Stage 5 and tenant-role checks.
- interoperability: POST returns both manifest and envelope from the same invocation. The earlier GET manifest may have a different generatedAt and therefore a different manifestHash. Sultan's bridge must validate and use the signed POST manifest rather than the GET preflight manifest before end-to-end staging is possible.
- limits: HMAC key possession does not establish independent sender authentication. This envelope v1 does not directly include the Stage 5 admission receipt identifier; the existing API gateway verifies Stage 5 before the signer is called. No production credential, deployed RLS or live acquisition has been tested.
- verification: Deterministic Node/tsx tests cover disabled flag, canonical signature, key encoding, OIDC identity, stale/tampered evidence, effectful calls and case mismatch. Exact-head release gate, CodeQL and review must pass before merge.
- next: Update Sultan A0 acquisition bridge to accept the same-invocation signed manifest with strict parity checks, then run cross-repository synthetic interoperability tests. Keep Partner Network disabled.
