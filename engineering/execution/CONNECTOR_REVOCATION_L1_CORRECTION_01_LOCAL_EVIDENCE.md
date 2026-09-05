# CONNECTOR-REVOCATION-L1-CORRECTION-01 local G0 evidence

- Authority: `CIBOTFLOW/Luzione-platform-program@8dbcc9b9b7429d00831aeb16139bd06644ea36bf`
- Assurance fingerprint: `b2e1923f459266b87ba54d77e189655e226eaacf566447a0107ecde1dbde51f3`
- Exact base: `0c970c0b54f190ba0b2d97629311d2712f9518e2`
- Contract implementation: `572d0f5e78558f8e6b8dcc2bf07210600edd20d0`
- Test-integrated implementation: `9edbedfa37020b3710090abe57a899cf0bc880eb`
- Final: peel detached annotated tag `CONNECTOR_REVOCATION_L1_CORRECTION_01_EXACT_FINAL`

The v2 request carries proposed selectors only. Luzione API must resolve the exact current same-tenant `ConnectorBinding/v1`, provider account, destination and standalone opaque credential-handle generation/version. The production constructor has no owner adapter and fails closed. The only exercised resolver and provider are synthetic/emulator implementations; no credential material, provider, hosted or production boundary was contacted.

## Exact local results

- `npm run test:connector-revocation-v2`: 16/16.
- `npm run test:connector-revocation`: 25/25.
- `npm run test:taxonomy`: 4/4.
- `npm run compliance:verify`: 7/7.
- `npm run verify`: typecheck pass, lint pass with zero warnings, 433/433 tests, Next.js 16.3.4 webpack build pass.
- `npm run proof:connector-revocation-v2`: pass; clean reverse 0/7 columns, reapply 7/7, forced-RLS/append-only/P110/owner binding/raw collision/forward recovery checks, automatic disposable cleanup.
- Git reverse apply check: pass.
- Frozen Core, effect-admission and operations-evidence tree comparisons: empty diff.

The first full test attempt passed 432/433 and failed only because the new suite was absent from the exhaustive test taxonomy. The classification was added and the complete gate reran green; the failure remains recorded.

## Bounded claim

This is a local G0 bounded candidate only. It is not integrated, G1, deployed, production-ready or evidence of real revocation/credential disposition. Exact-head CI, preview application readback, an admitted owner adapter, independent L2 consumption, managed recovery and every G2 action remain outside this proof.
