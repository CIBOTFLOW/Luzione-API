# ONBOARD-CORE-CORRECTION-02 Working Contract

- Project: `ONBOARD-CORE-CORRECTION-02`
- Controller authority: `CIBOTFLOW/Luzione-platform-program@4cd6e143c05d9318006b033d5331bba9bb7d5e6a`
- Assurance input: `ONBOARD-CORE-CORRECTION-ASSURE-01@9e1e2f515f8445e17a9168261676de4697182d903689e7c7e1f330c9cda54352`
- Exact base: `CIBOTFLOW/Luzione-API@221d2b96b970a8036923b28a1e3ebc7fe489db34`
- Branch: `codex/onboard-core-correction-02-g0-4cd6e14`
- Effect authority: `NO_EFFECT` (the preserved SandboxEcho boundary remains the only executable adapter)

## Capability outcome

Close only the two failed ONBOARD-CORE-CORRECTION-ASSURE-01 claims: validate raw Tenant Pack strings against the pinned JSON Schema before canonicalization, and make the correction reverse fail closed before any DDL when v2-only provenance exists.

## Entrypoints and expected end state

1. `parseTenantBlueprintProposal` receives the existing `LuzioneOnboardCoreApi/v2` proposal. It rejects raw strings outside the pinned schema bounds and rejects stable IDs whose original bytes violate the schema pattern, before trimming or hashing can collapse them onto a different packet.
2. `scripts/validation/rollback-onboard-core-correction-01.sql` receives an isolated correction-v2 schema. It permits the already-proven empty/pre-activation reverse, but raises before the first DDL if any append-only revocation or other v2-only provenance exists.

## Truth, writer, and readback

- The unchanged bytes of `contracts/onboard-core/luzione-tenant-pack-draft-v1.schema.json` remain the authoritative input-string bounds and stable-ID pattern.
- Luzione API remains the sole parser and persistence-contract writer.
- Parser errors and post-failure catalog/data readback are authoritative bounded proof surfaces. No hosted or production readback is claimed.

## Consumed and published contracts

- Consumed unchanged: `LuzioneTenantPackDraft/v1`, `TenantPackSourceBinding/v1`, `LuzioneOnboardCoreApi/v2`, `TenantBlueprintMap/v2`, `SetupMandateRevocation/v1`, `CRMImportDryRunMap/v2`, `ConnectorSyncValidation/v2`, and every frozen Core/effect/revocation/operations contract at the exact base.
- Published: no new contract version. This is a fail-closed schema/parser parity correction and reverse-safety correction with resealed evidence only.

## Dependencies and mutation cone

- Dependencies: exact API base, the pinned Tenant Pack schema digest, the existing correction migration, and a disposable local PostgreSQL container.
- Mutation cone: onboarding parser, onboarding parser tests, correction reverse preflight, isolated reverse fixture/proof, package proof command, and execution evidence metadata.
- No route, forward migration, table, provider, credential, scheduler, deployment, or production mutation is admitted.

## Invariants and explicit non-scope

- Raw input is checked before normalization; distinct schema-invalid packets cannot collapse onto one admitted canonical packet.
- Reverse refusal occurs before all DDL and preserves both v2 data and v2 schema.
- Empty/pre-activation reverse/reapply remains bounded local evidence only and grants no production rollback authority.
- Existing contract identifiers and the pinned Tenant Pack schema bytes remain unchanged.
- No production query/migration, credential resolution, provider call, activation, deployment, merge/default-branch action, or rollback.

## Acceptance proof

- Exact 201-plus bounded-text, whitespace stable-ID, and raw-versus-canonical collision negatives over the pinned schema.
- Exact legacy `SetupMandate/v1` plus v2 append-only revocation reverse refusal, followed by schema and data preservation readback.
- Empty correction reverse and reapply still pass in a disposable database.
- Existing onboarding focused tests/proofs and full compliance, typecheck, lint, test, and build pass.
- Exact implementation/final SHAs, artifact digests, reverse proof, automation/preview truth, and a detached exact-final attestation are published without self-hashing.

## Irreversible effects

None. All SQL proof databases and roles are disposable and removed by trap cleanup.
