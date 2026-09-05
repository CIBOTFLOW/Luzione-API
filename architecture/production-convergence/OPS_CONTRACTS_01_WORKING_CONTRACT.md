# OPS-CONTRACTS-01 Working Contract

Status: G0 documentation/schema/SDK/test candidate only. Effect authority is `NO_EFFECT`; no operational record, runtime capability, proof window, stage, or production-readiness claim is activated by this work.

## Capability outcome

`OPS-CONTRACTS-01` publishes a separate API-owned `LuzioneOperationsEvidence/v1` bundle that makes PROOF-OPS-01 and CUSTOMER-ZERO-OPS-01 evidence mechanically strict and independently consumable. It composes with the frozen `LuzioneCoreContracts/v1` bundle without changing that bundle's bytes, semantics, identifiers, or SDK.

The source specifications are bound by immutable fingerprints:

- `PROOF-OPS-01/v1`: `b2c79f6a580267adfcac1745047518979070ee3f18d90df478dc4b6ec511cb8b`.
- `CUSTOMER-ZERO-OPS-01/v1`: `ae1c5225f8bb1c45420572433ac659ff054a1fd2bfad1cb2bf740e5ae008e57c`.

## Entrypoint and end state

The only entrypoint in this branch is an offline strict parser or generated consumer SDK call over an in-memory document. A successful end state is a version-bound, exact-field, immutable, tenant-bound, no-secret/no-PII evidence record whose deterministic formulas, state transitions, observation clock, owner coverage, and referenced evidence all validate. A failure produces a typed fail-closed compatibility error.

No HTTP route, persistence adapter, scheduled job, provider client, credential access, migration, deployment, feature activation, proof-window start, stage advance, or rollback execution is introduced.

## Authoritative truth, writer, and readback

- Luzione API owns the shared operations-evidence schemas, versions, formula/state/clock rules, and consumer SDK.
- The canonical systems referenced by an `EvidenceRef/v1` remain authoritative for the underlying observation; this bundle stores no observation and makes no source-finality claim by itself.
- Every record is immutable. Corrections must publish a new record with `supersedesRecordId`; overwriting a prior record is invalid.
- Human accountability may not be delegated to Sultan or another agent. Agents may prepare evidence only and cannot own, approve, waive, close, or advance an operational stage.
- Missing or stale telemetry receives no proof-day credit. Hard-zero failures cannot be waived.

## Published contracts

Common contracts:

- `EvidenceRef/v1`
- `MetricCatalog/v1`

Proof operations:

- `ProofWindowEntry/v1`
- `ProofDailyRecord/v1`
- `ProofWeeklySignoff/v1`
- `CapabilityWindowLedger/v1`
- `EvidenceCompletenessReport/v1`
- `ProofException/v1`
- `ProofIncident/v1`
- `ProofExitDecision/v1`

Customer-zero operations:

- `CustomerZeroCadence/v1`
- `CaseHandoff/v1`
- `TrainingAttestation/v1`
- `FeedbackRecord/v1`
- `ChangeFreeze/v1`
- `CapacityObservation/v1`
- `StageReadiness/v1`

All v1 documents reject surplus fields, missing fields, and unknown versions. Additive or breaking changes require a new explicit version and consumer repin decision.

## Composition and mutation cone

The bundle pins the frozen Core producer pair `828de754e4104cd860e3f47adbf2e84c576e5c10` / `bb5eb395af0873f4483ba2dc10c76f9941051dde` and `LuzioneCoreContracts/v1`. The pre-work Core trees are `d57ccc4cccd97b37acd1a1575b1e07ede5787349` for `contracts/core` and `d594fa014d7020fdf8386c7a6926ff9b573ac355` for `src/modules/luzione-core-contracts`; both must be identical after implementation.

The mutation cone is limited to this working contract, a new operations-evidence schema/manifest/consumer mappings, a new parser/SDK/fixture/test module, test taxonomy and script registration, and repository-local proof/handoff metadata.

## Deterministic laws

1. Evidence references bind an exact 40-character release SHA, artifact version, SHA-256 digest, observation time, classification, verifier, and tenant; secret/PII content and mutable refs are forbidden.
2. Completeness is `presentValidEvidenceCount / requiredEvidenceCount` in basis points, with zero denominator yielding zero. Missing evidence never earns credit.
3. A daily proof credit is exactly one only when telemetry coverage and completeness are 10000 basis points, every required capability has an accountable owner and valid evidence, no blocking incident exists, and every hard-zero counter is zero. Otherwise it is zero.
4. A telemetry-gap day cannot be credited. A hard-zero breach cannot be waived by an exception.
5. Capacity utilization is deterministic basis-point division of required minutes by available minutes. Overrun blocks admission.
6. Training is current only through its exact expiry time. Stage readiness cannot use stale training, incomplete handoffs, missing evidence, capacity overrun, bundled G2 approval, or a stage jump.
7. All validation accepts an explicit assessment clock; fixtures and tests never depend on wall-clock timing.

## Explicit non-scope and irreversible effects

Routes, database objects, truth-store changes, credentials, migrations, providers, deployments, default-branch action, merge, activation, proof execution, production/customer data, stage execution, and rollback are excluded. There are no irreversible effects in this G0 branch.

## Acceptance proof

Before handoff, the exact candidate must pass:

1. strict parsing of all seventeen document versions and the manifest;
2. missing owner, coverage, evidence, unaccepted handoff, stale training, manifest drift, capacity overrun, false stage advance, bundled G2, hard-zero waiver, telemetry-gap credit, unsafe agent authority, overwrite, secret/PII, surplus, missing, and wrong-version negatives;
3. deterministic completeness, daily-credit, capacity, state-transition, supersession, and clock tests;
4. mechanical Core tree identity and packet-fingerprint checks;
5. L2 and L3 exact-pin consumer packets;
6. compliance, typecheck, lint, full test suite, and production build;
7. exact reverse-patch check without executing rollback;
8. exact-head automated CI when repository workflow policy permits it.

Local/CI success supports only a bounded G0 claim. Consumer integration, activation-cone clearance, authenticated deployed readback, live proof days, recovery evidence, G1, and every G2 authority remain separate prerequisites.
