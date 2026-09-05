# ONBOARD-CORE-01 G0 Working Contract

Status: bounded local pass on a non-default branch. This is not G1, integrated, deployed, activated, or production-ready.

## Outcome and authority

Luzione API is the sole canonical writer for the onboarding boundaries. It derives tenant, actor, request identity, Blueprint/Mandate/Batch identity, policy references, approval evidence, expiry, limits, prohibitions, rollback reference, idempotency and object versions. L2 Tenant Pack is proposal-only and may submit only exact `LuzioneTenantPackDraft/v1` DRAFT content plus immutable source/schema digests.

The default-off boundaries are:

- GET/POST `/api/v1/onboarding/tenant-blueprints`
- POST `/api/v1/onboarding/tenant-blueprints/approvals`
- GET/POST `/api/v1/onboarding/setup-mandates`
- POST `/api/v1/onboarding/imports/dry-runs`
- GET `/api/v1/onboarding/imports/{batchId}`
- POST `/api/v1/connectors/sync-validations`

All writes reuse P110 reservation/receipt/event/outbox evidence. Blueprint, Mandate and dry-run import records are tenant-scoped, forced-RLS and append-only. Connector validation uses the existing provider runtime and `SandboxEchoProviderAdapter`, adds no relation or migration, and returns only L1-issued `SyncReceipt/v1` sandbox finality. No route resolves a credential value, schedules work, invokes a production adapter, commits CRM imports, enables a hosted effect or changes the frozen Core schema/SDK.

## Mapping and replay boundaries

- Blueprint mapping is exactly `TenantBlueprintMap/v1`; reservation identity is authenticated tenant + `sourcePackId` + `sourcePackVersion` + canonical source digest + mapping version.
- L1 recomputes every draft/source/connector payload digest. Digest mismatch fails closed.
- Exact replays return the original P110 receipt. Changed content under the same tenant/key conflicts and does not create a second canonical mutation or provider dispatch.
- Only a credential-bound human may append approval/supersession. Approved records are never updated or deleted. A Mandate pins an approved, unsuperseded, active same-tenant Blueprint and expires after 24 hours.
- Import mapping is exactly `CRMImportDryRunMap/v1`. The Mandate must explicitly allow `DRY_RUN_IMPORT`; Batch effect mode equals Receipt effect mode; status/finality pairs are closed; rejected/conflicted rows retain durable exception/reconciliation references; `VALIDATED_NO_EFFECT` is never CRM commit finality.
- Connector validation is exactly `ConnectorSyncValidation/v1`; only an exact service actor, DRAFT `ConnectorBinding/v1`, approved provider, opaque `secret-ref:` binding, tenant/key reservation and `sandbox.echo` destination are admitted. Ambiguous acknowledgement reconciles without redispatch. L1 alone issues `SyncReceipt/v1` finality.

## Mutation cone and acceptance proof

New relations are limited to `onboarding_tenant_blueprint_drafts`, `onboarding_tenant_blueprint_approvals`, `onboarding_setup_mandates`, `onboarding_import_batches`, `onboarding_import_rows` and `onboarding_import_receipts`. The first three belong to migration `20260905040000`; the latter three belong to separately reversible migration `20260905041000`; connector validation has zero schema delta.

Acceptance requires strict field/version parsing; client-authority, wrong/surplus/digest/tenant/stale/expired/revoked/superseded, cross-tenant and finality negatives; exact replay and changed-content conflict; ambiguous acknowledgement without redispatch; tenant-bound readback; migration apply/readback/rollback/reapply reconciliation; frozen Core tree equality; focused tests; and full compliance/typecheck/lint/test/build.

The immutable semantic pins are `27b50a89658fe1572bfefe6ef6e02d993deaceb7` for Blueprint/Mandate, `46a14c3a499d57c8699395d714bb44e9a4576ab6` for import dry-run and `7f937c515960cb522215ae7e928b3075049477fe` for connector validation. The later registry-only reconciliation at `cd5a9c091c61e1891112c94282c0f8882bf343ee` does not change those slice artifacts.
