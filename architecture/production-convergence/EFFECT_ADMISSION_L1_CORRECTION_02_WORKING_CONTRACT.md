# EFFECT-ADMISSION-L1-CORRECTION-02 working contract

Project: `EFFECT-ADMISSION-L1-CORRECTION-02`, absorbed into the single active `CONNECTOR-REVOCATION-L1-G0` writer under controller `055cf5a5d277bead4b02146a05869d91712e5c91` and assurance fingerprint `f2e0de88dae65aad46ca5ec80872f523950289326275791e651e2d9ed0cb4548`, from exact API base `5786d9d6f1d38e730e404cade4dd466dbb709367`.

Outcome: close the remaining v2/v0.3 effect-admission ambiguity without changing any published contract identifier. Every gate return is strict-parsed and matched to the exact subject and required prior decision before credential release. After the immutable execution envelope is inserted with `STARTED`, the worker obtains one fresh fail-closed `PROVIDER_PRE_EXECUTE` decision immediately before calling the adapter and requires the decision reference, kill version, execution identity and envelope identity to remain unchanged.

Reconciliation checkpoints now select one immutable P110 delivery-attempt tuple: tenant, outbox message, attempt ID and attempt number. A composite foreign key prevents cross-tenant, foreign-outbox and foreign-attempt lineage. Reconciliation admission and completion load that tuple from the checkpoint and never follow the mutable outbox `attempt_count`.

Provider descriptor and prepared-dispatch destination syntax is identical at registry, parser and schema boundaries: exact untrimmed value, the existing lowercase segmented destination grammar and maximum length 190. The v0.3 registry rejects every wrong-version or non-`SANDBOX` adapter before work or credential release.

Entrypoints remain the existing P110 provider worker and Sultan prepare/execute boundaries. Contract pins remain `luzione-effect-admission/v2`, `luzione-effect-execution-envelope/v1`, `luzione-provider-adapter/v0.3`, `luzione-prepared-provider-dispatch/v1` and `luzione-provider-credential-release/v1`.

Mutation cone: effect decision assertion, provider registry/parser/runtime, Sultan decision consumption, P110 attempt/checkpoint selection, one additive reversible migration, focused adverse probes and execution evidence. Frozen `LuzioneCoreContracts/v1` trees remain unchanged.

Acceptance: post-`STARTED` kill denies before execute; foreign or malformed decisions deny before credential release; changed subject/prior/decision/kill/envelope identity denies; reconciliation binds the originating immutable attempt and cannot select a later outbox attempt; whitespace and over-190 destinations fail; live and wrong-version adapters fail at registration; schema/parser parity, disposable reverse/reapply and full repository gates pass.

Non-scope: live adapter registration, credential resolution, provider/customer effect, production database/query/migration, deployment, merge, default branch, activation, G1/G2 or production readiness. Irreversible effects: none. Effect authority remains `SANDBOX_ONLY`; exercised effects are zero.
