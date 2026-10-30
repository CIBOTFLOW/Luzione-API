# Default-off independent Stage 5 A0 admission readback

Date: 2026-10-30. Mode: SHADOW. Baselines: API `30d509ef2f2612af170103e8a9c6e200a6422784`, Sultan `2704be3c4d954c5f8cbcaadfc8e67a5629e07905`, UI `9da4c59897bb99ed27907e9ec7f135f88bd68816`.

## Root cause discovered

The A0 signed tool invocation expects the Stage 5 admission to carry `purpose=sultan-shadow-case-read` and `requestedCapability=sultan.case.read`. The existing Stage 5 policy registry admitted the three corresponding agents **only** for `agent-case-post-inference` and `analysis.read`. This meant the signed A0 path was not actually reachable even though independent signer and consumer tests passed. The new policy allowance is restricted to COMMERCIAL, FULFILLMENT and CATALOG_QUALITY stewards, SIMULATION phase, A0 effect class, and the exact shadow purpose/capability. It grants neither inference nor business execution and does not include Partner Network.

## Readback implementation

`POST /api/v1/sultan/admission-readbacks` is disabled unless `LUZIONE_SULTAN_STAGE5_READBACK_ENABLED=true` is explicitly provisioned. It requires a separately verified Vercel OIDC token for `service:sultan-os` with the **new dedicated** `sultan.stage5.admission.read` capability. The route accepts only a bounded `{ "admissionReceiptId": "s5admit_..." }` body and does not place receipt identifiers in URL query strings or request logs. Existing PostgreSQL methods run tenant-bound READ ONLY transactions and verify JSONB receipts against indexed database columns. No new database migrations or writes are introduced.

The bundle gate checks the complete admission integrity hash, exact tenant/workload identity, no-effect status, phase, purpose, capability, admission freshness, all unique canonical readback identifiers, readback hashes, PostgreSQL provenance, readback freshness, evidence-set hash, and consumed-claim lineage. Missing or cross-tenant rows fail closed with sanitized errors. No response is served if any reference fails.

## Verification and limits

The new deterministic regression exercises an admitted synthetic Stage 5 case, an actual canonical readback receipt, and negative controls for disabled flag, wrong tenant/actor/source/capability, malformed ID, missing admission, missing or tampered readback, expired evidence, and invalid A0 scope. The complete API Release gate and CodeQL must pass at the exact PR head before merge. CI results must be recorded in the PR.

**Not an authenticated live proof:** Tests use synthetic receipt fixtures and an injected store. A valid HMAC does not establish production sender identity or signing-key custody. Deployed PostgreSQL credentials, actual RLS policies, endpoint capability provisioning, and a live Stage 5 admission-to-Sultan readback have not been verified. Do not enable this route or signing flags on production without those checks. Partner Network remains OFF; Sultan remains SHADOW.

## Next

After the readback PR passes security review, build a default-off Sultan OIDC transport adapter with exact response schema, bounded timeouts and independently verified workload identity; test it against a disposable two-tenant PostgreSQL deployment, then verify deployed role/policy and key custody before any production activation. No paid APIs, customer sends, business mutations, or live agents.
