# CONNECTOR-REVOCATION-L1-G0 bounded evidence — 2026-09-05

Repository: `CIBOTFLOW/Luzione-API`
Branch: `codex/connector-revocation-l1-g0-6ea7045`
Base: `5786d9d6f1d38e730e404cade4dd466dbb709367`
Effect Correction-02 semantic pin: `86809a9243c594a2898d31d14bbeda3324cacd7b`
Connector Revocation semantic pin: `a1329b669262b2abbffc8e9ec501e866429c0d55`
Final: peel annotated tag `CONNECTOR_REVOCATION_L1_G0_EXACT_FINAL` after the evidence-only commit.

The connector pin adds strict `ConnectorRevocationRequest/v1`, `ConnectorRevocationReceipt/v1` and `ConnectorCredentialHandle/v1` packets, a default-off service-plus-human POST, same-tenant GET, forced-RLS append-only storage and one `SANDBOX`/`NO_EFFECT` emulator. It reuses P110 reservation, delivery and source-reconciliation evidence. Provider acknowledgement never proves remote revocation or permits erasure. `REVOKED` requires matching source readback; forward recovery is a separate genuine-human append that may authorize a no-effect local disposition without changing the prior non-success remote finality.

The preceding Effect Correction-02 pin preserves the five v2/v0.3 identifiers and adds exact decision subject/prior validation, a fresh post-`STARTED` pre-execute decision, immutable tenant/outbox/delivery-attempt reconciliation lineage, destination whitespace/190-character parity and fail-fast rejection of non-sandbox or wrong-version adapters.

Exercised negatives include surplus, missing and wrong version; request/receipt digest drift; changed-payload P110 conflict; cross-tenant binding/readback; provider-account, binding and credential-generation drift; active kill; provider ACK without source finality; source unavailable; ambiguous/exhausted reconciliation; version mismatch; failed remote revoke; erasure before source confirmation; forward recovery without false finality; foreign originating attempt; foreign gate decision before credential release; post-`STARTED` kill; whitespace/overlength destination; and LIVE/wrong-version adapter registration.

Disposable PostgreSQL evidence used a unique local database and non-bypass runtime member, then cleaned it. It proved forced RLS, cross-tenant invisibility, append-only update/delete rejection, invalid-finality rejection, immutable attempt foreign-key rejection, exact replay, changed-payload conflict, source-confirmed revocation, failed revoke, forward recovery, kill denial and emulator-only P110 outcomes. Reverse proof observed zero connector/correction objects, reapply observed four, and the cleanup trap removed the database/login.

Local verification before sealing: compliance 7/7; typecheck pass; lint zero warnings; focused effect 23/23; focused revocation 9/9; full suite 400/400. The production build is rerun after evidence metadata is complete. No remote Supabase project, production database, credential, provider, hosted poll, deployment, merge, default branch, activation or rollback was accessed or changed.

Strongest claim: `BOUNDED_PASS | LOCAL_PROVEN | SANDBOX_ONLY | BOUNDED_CLAIM`. This is not G1, G2, integrated, live-effect authorized or production-ready evidence. Exact-head CI, consumer evidence, authenticated deployed readback and managed recovery remain external stops.
