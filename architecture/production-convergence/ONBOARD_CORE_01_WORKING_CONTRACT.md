# ONBOARD-CORE-01 G0 Working Contract

Status: implementation in progress on a non-default branch. This is not G1, integrated, deployed, activated, or production-ready.

## Outcome and authority

The authenticated entrypoints are the default-off `/api/v1/onboarding/tenant-blueprints` and `/api/v1/onboarding/setup-mandates` boundaries. Luzione API is the sole canonical writer and derives tenant, actor, request identity, Blueprint/Mandate identity, policy references, approval evidence, expiry, limits, prohibitions, rollback reference, idempotency and object versions. L2 Tenant Pack is proposal-only and may submit only exact `LuzioneTenantPackDraft/v1` DRAFT content plus immutable source/schema digests.

The first independently reviewable slice ends at an approved, append-only `TenantBlueprint/v1` and an immutable expiring `SetupMandate/v1`. It uses P110 reservation/receipt/event/outbox evidence with `NO_EFFECT`; GET reads are tenant-bound Postgres readbacks. The current slice never connects a UI writer, resolves credentials, invokes a provider, schedules work, changes a Core schema, or enables a hosted effect.

## Required mapping boundary

- Mapping version is exactly `TenantBlueprintMap/v1`.
- Reservation identity is derived from authenticated tenant + `sourcePackId` + `sourcePackVersion` + canonical source digest + mapping version.
- The API recomputes the canonical draft digest. A mismatch is rejected.
- Replaying the exact tuple returns its original P110 receipt. Changed content under the same source pack version conflicts through the append-only unique source identity.
- L1 namespaces and issues required field, connector, retention and AI-policy references plus all other Core Blueprint section references.
- Only a credential-bound `user` may append approval/supersession. Approved records are never updated or deleted. Supersession appends explicit lineage and preserves the prior approval document.
- A Mandate pins an approved, unsuperseded, same-tenant Blueprint; L1 issues a 24-hour expiry, bounded limits, the exact no-effect action set, all Core prohibitions and rollback authority.

## Mutation cone and acceptance proof

New relations are limited to `onboarding_tenant_blueprint_drafts`, `onboarding_tenant_blueprint_approvals`, and `onboarding_setup_mandates`. They are tenant-RLS, append-only, and reuse the existing P110 command ledger. Acceptance requires strict parser tests; client-authority, wrong/surplus/digest/tenant/stale/supersession/expiry/revocation negatives; exact replay and changed-content conflict; cross-tenant absence; migration apply/readback/rollback/reapply reconciliation; frozen Core contract/SDK tree equality; and full compliance/typecheck/lint/test/build.

The later separately reviewable slices add staged ImportBatch/ImportReceipt persistence and exactly one sandbox connector validation endpoint. They may not expand this slice's authority.
