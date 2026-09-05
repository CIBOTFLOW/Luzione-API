# CORE-01 Working Contract

Status: G0 library candidate only. Runtime activation is dark, effect authority is `NO_EFFECT`, and no production-readiness claim is made.

## Capability outcome

`CORE-01` publishes one API-owned `LuzioneCoreContracts/v1` bundle for deterministic Core admission and evidence across operation, receipt, readback, tenant onboarding, import, connector synchronization, and support. The SUPPORT-01 L1 addendum is included in the same mutation cone under `SUPPORT-01/L1-CORE-CONTRACTS/v1`.

## Entrypoint and end state

The future entrypoint is an authenticated API boundary that derives credential actor, logical actor, tenant, purpose, correlation, and authority before parsing a contract. This branch exposes library parsers and fixtures only. Its strongest end state is a strictly parsed, tenant-bound, version-bound, no-effect document or a typed fail-closed compatibility error.

No HTTP route, database write, provider dispatch, credential read, migration, deployment, or feature activation is introduced.

## Authoritative truth, writer, and readback

- Shared identity/tenant/command/receipt/readback meaning remains owned solely by `CIBOTFLOW/Luzione-API` through the preserved A02 five-pin bundle.
- CRM records remain owned by their admitted CRM domain owner; Sultan may propose or investigate but may not become a record or journal writer.
- A provider acknowledgement is not business completion. `SultanReadback/v1`, `SyncReceipt/v1`, support action finality, and customer reply finality require authoritative source readback before source-confirmed closure.
- `SupportCase/v1` carries the current object version and audit head. `SupportAction/v1` and `CustomerReply/v1` append to that evidence chain without rewriting history.

## Consumed contracts

The bundle consumes exactly, without reinterpretation:

- `luzione-shared-contracts/v0.2-draft.1`
- `luzione-identity-tenant/v0.2-draft.1`
- `luzione-command-envelope/v0.2-draft.1`
- `luzione-receipt-envelope/v0.2-draft.1`
- `luzione-readback-envelope/v0.2-draft.1`

The A02 implementation/evidence pair is preserved at `12685f46a60edea23aaa0a5403e300bf8858066b` / `bc43d5db8fe58230d6c3d35e32a73e1e8618b71e`.

## Published contracts

- Core: `SultanOperation/v1`, `SultanReceipt/v1`, `SultanReadback/v1`.
- Onboarding: `TenantBlueprint/v1`, `SetupMandate/v1`.
- Import: `ImportBatch/v1`, `ImportReceipt/v1`.
- Connector: `ConnectorBinding/v1`, `SyncReceipt/v1`.
- Support: `SupportCase/v1`, `SupportAction/v1`, `CustomerReply/v1`.
- Release controls: `LuzioneCoreFeatureFlags/v1`, `LuzioneCoreReleaseManifest/v1`.

All v1 boundaries reject surplus and missing fields and unknown versions. Future additive evolution requires an explicit new compatibility decision; breaking meaning requires a new major contract.

## Version semantics

The Core projection is lossless:

| A02 field | Core field | Meaning |
|---|---|---|
| command `expectedObjectVersion` | operation `versionIntent.preconditionVersion` | version on which admission depends |
| command `target.objectVersion` | operation `versionIntent.targetVersionAtRequest` | observed target version when the request was prepared |
| receipt `object.version` | receipt `versions.committedVersion` | canonical owner version after commit |
| readback `object.version` | readback `versions.observedVersion` | authoritative version observed during readback |

These values may be equal in a no-op fixture but cannot be collapsed into one semantic field.

## SUPPORT-01 policy invariants

- Actor and tenant identity are server-derived; revoked membership or entitlement denies.
- Support policy, entitlement, and SLA evaluations carry explicit versions.
- Reuse of an idempotency key with a changed payload fails as replay conflict.
- Stale case/evidence versions deny; indeterminate results cannot claim finality.
- Effectful support actions and reply delivery require reservation plus the policy-required approval.
- Severity decreases require explicit approval evidence.
- SLA pause is legal only with a supported reason and pause timestamp.
- Verified close, action completion, and sent reply require source readback evidence.
- Audit heads append by exact sequence and predecessor digest.

## Dependencies and mutation cone

The implementation extends the existing platform contract registry, test taxonomy, A02 consumer validators, and proof ledgers. It creates no service, table, schema, queue, provider adapter, or truth store. It has no FEP dependency.

The six RUNTIME-01 capabilities at Sultan final `e2b95ab71e5a604dcdd8ff6ab75b50a32ba4d838` receive a mechanical consumer mapping only. Sultan binding remains `PENDING_L1_FREEZE` until this exact candidate is frozen and independently consumed.

## Explicit non-scope and irreversible effects

Production data, migrations, credentials, OAuth completion, provider calls, external communication, default-branch action, merge, deployment promotion, rollback execution, FEP, economic journals, payments, and public activation are out of scope. There are no irreversible effects in this G0 branch.

## Acceptance proof

Before handoff, the exact candidate must pass:

1. strict positive parsing for all 14 documents;
2. surplus, missing, and wrong-version sensitivity for every document;
3. A02 version/provenance mapping and tenant/reference negatives;
4. onboarding/import/connector limits, secret-reference, and finality negatives;
5. SUPPORT-01 actor, entitlement, replay, stale, SLA, severity, ambiguity, approval, audit, closure, and readback negatives;
6. six-capability RUNTIME-01 mapping verification;
7. compliance, typecheck, lint, full test suite, and production build;
8. exact reverse-patch rollback check without executing rollback;
9. automated CI at the exact pushed head when repository workflows permit it.

Local/CI success remains a bounded G0 claim. Authenticated preview readback, L2/L3 exact consumer evidence, controller acceptance, managed recovery, A01/D01 closure, and all G2 authority remain separate prerequisites.
