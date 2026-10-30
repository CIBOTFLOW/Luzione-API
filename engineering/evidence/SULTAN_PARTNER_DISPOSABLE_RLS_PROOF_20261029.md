# Sultan Partner Network — disposable PostgreSQL two-tenant proof harness

Date: 2026-10-29. Source: Luzione API main and draft PRs #89–#92; Sultan OS draft PRs #342–#347; Luzione UI main agent registry.

## Why this is the next gate

Partner Network A0 reads are implemented behind a default-OFF feature flag. The four CRM tables have RLS enabled, but three lack SELECT-capable policies in the previously observed Luzione catalog. PRs #91 and #92 added role-activation and policy-presence checks. Those checks are necessary but cannot establish tenant policy correctness or applicability to the deployed credential.

## Added code

- `scripts/validation/rls-proof-contract.mjs`: fail-closed disposable database name, explicit confirmation, empty source-table checks, and per-source visibility assertions.
- `scripts/validation/rls-proof-contract.test.mjs`: 21 dependency-free deterministic tests, including foreign-row visibility and missing own-row negatives for all four CRM tables.
- `scripts/validation/sultan-partner-rls-disposable-proof.mjs`: opt-in integration harness for an **already provisioned, fresh, disposable PostgreSQL database**. It creates synthetic Luzione and foreign-tenant rows, a restricted NOBYPASSRLS role, four tenant-scoped SELECT policies, and calls the real `readPartnerCase` adapter. It checks both directions of tenant visibility, the authorized partner read, foreign account denial, and fail-closed behavior when a SELECT policy is dropped. Cleanup removes the synthetic tables and role.

## Run only with an independently provisioned local disposable database

Create an empty database with a name matching `sultan_rls_disposable_[a-z0-9_]+` on an existing local PostgreSQL instance. Use an administrative credential that can create and SET ROLE in that disposable database. **Do not point this harness at Supabase production or any shared database.**

```sh
node --test scripts/validation/rls-proof-contract.test.mjs
export SULTAN_RLS_PROOF_DATABASE_URL='postgresql://<local-admin>@localhost:5432/sultan_rls_disposable_test01'
export SULTAN_RLS_PROOF_CONFIRM='I_CONFIRM_DISPOSABLE_ONLY'
node --import tsx scripts/validation/sultan-partner-rls-disposable-proof.mjs
```

The harness refuses missing confirmation, unexpected database names, preexisting CRM source tables, and an existing test role. It does not create a database, migrate production, or read customer records. It logs no credentials or raw synthetic records. The role created is **synthetic**; this is not proof of the actual deployed API credential.

## Verified in this run

- Node v22.16.0: `node --test rls-proof-contract.test.mjs` passed **21/21** locally.
- `node --check sultan-partner-rls-disposable-proof.mjs` passed.
- No-URL invocation failed closed with `DISPOSABLE_DATABASE_URL_REQUIRED`.
- **NOT RUN:** live disposable PostgreSQL integration proof (PostgreSQL and pg module are not available in this execution container); repository CI and real runtime role checks remain separate.

## Promotion blockers

1. Execute the integration harness against a truly disposable local PostgreSQL instance; preserve exact run receipt and teardown evidence.
2. Review/implement correct tenant-scoped SELECT policies in a separate, authorized migration. Production currently lacks three policies.
3. Verify the actual deployed API credential is non-owner/non-BYPASSRLS and tenant policy checks hold with that role.
4. Exercise Stage 5 authenticated Partner Network A0 receipts and canonical Sultan SHADOW projection; check stale/version mismatch and cross-tenant denial.
5. Keep `LUZIONE_SULTAN_PARTNER_A0_ENABLED` OFF; do not merge or deploy this test-only draft without review.

Actual verified outcome: **OFFLINE_CONTRACT_TESTS_PASSED**; production tenant isolation: **NOT_OBSERVED**. No paid calls, customer messages, business writes, production DDL, or deployment.
