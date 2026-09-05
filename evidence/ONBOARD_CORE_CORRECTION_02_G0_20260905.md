# ONBOARD-CORE-CORRECTION-02 bounded G0 evidence

Controller authority: `CIBOTFLOW/Luzione-platform-program@4cd6e143c05d9318006b033d5331bba9bb7d5e6a`  
Assurance fingerprint: `9e1e2f515f8445e17a9168261676de4697182d903689e7c7e1f330c9cda54352`  
Base: `221d2b96b970a8036923b28a1e3ebc7fe489db34`  
Implementation: `533c1f5bb287c03cb74e9e66c64808d4b1a8a8f0`  
Final: peel `ONBOARD_CORE_CORRECTION_02_EXACT_FINAL` after the evidence commit  
Authority: `NO_EFFECT`; production credit: `0`

## Exact bounded verdict

The two assigned assurance failures pass locally. Tenant Pack bounded strings are measured on original Unicode code points before canonicalization, stable IDs are matched against their original bytes, and invalid raw packets cannot collapse into an admitted canonical packet. The correction reverse now performs a complete v2-provenance preflight before its first DDL statement and refuses the exact legacy `SetupMandate/v1` plus v2 append-only revocation case without losing schema or rows.

No contract identifier, pinned Tenant Pack schema byte, forward migration, frozen Core tree, onboarding runtime, effect-admission tree, connector-revocation tree, or operations-v3 tree changed.

## Exact adverse evidence

- 200 Unicode code points: accepted at the exact schema bound.
- 201 raw characters that trim to valid bounded content: `INVALID_REQUEST`.
- Whitespace-padded stable ID that trims to a valid ID: `INVALID_REQUEST`.
- Raw and canonical packet hashes differ; only the schema-valid canonical packet parses.
- Empty/pre-activation correction reverse: pass; unchanged forward migration reapply: pass.
- Legacy `SetupMandate/v1` plus one `SetupMandateRevocation/v1` row: `ONBOARD_CORE_CORRECTION_REVERSE_BLOCKED_V2_PROVENANCE` before DDL.
- Post-refusal readback: revocation relation present, revocation rows `1`, legacy mandate rows `1`, source-binding columns `1`, runtime columns `1`.

## Verification

- Compliance: `7/7`.
- Typecheck: pass.
- Lint: pass with zero warnings.
- Onboarding focused tests: `17/17`.
- Full suite: `447/447`.
- Next.js `16.3.4` webpack build: pass.
- Blueprint/Mandate disposable proof: pass.
- Import disposable proof: pass.
- Connector SandboxEcho disposable proof: pass with `3` NO_EFFECT outbox records, `1` source-confirmed result, `1` blocked result, and zero connector schema delta.
- Correction-02 reverse proof: pass with automatic disposable database cleanup.

The first connector rehearsal exposed a proof-harness migration drift: the current frozen runtime expected the already-existing effect-admission correction-02 columns. The harness now applies those frozen migrations and `pgcrypto`; no runtime or contract semantic changed. The rerun passed.

## Deferred truth

Exact-final automation and preview truth are obtained after the final evidence commit is pushed. No production surface was queried. No managed migration, backup/PITR, credential, provider, deployment, activation, merge, default-branch action, or rollback occurred. This evidence is neither integrated nor production-ready.
