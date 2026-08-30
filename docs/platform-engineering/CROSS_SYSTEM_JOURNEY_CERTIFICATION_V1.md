# Cross-System Journey Certification V1

Project: `API_SE_019`  
Canonical source: `src/modules/platform-journeys/certification.ts`  
Contract version: `luzione-cross-system-journey-certification/v1`

## Working contract

- Capability outcome: certify representative UI to API to Sultan/provider to authoritative-readback journeys without treating producer evidence as consumer integration.
- Actor/system entrypoint and end state: an exact-version journey evidence bundle enters the API-owned certification function and exits as `CERTIFIED` only when API, UI and Sultan evidence independently proves the same contract journey.
- Authoritative truth and write owner: each repository owns its own test output and exact candidate SHA; the API owns only certification semantics and the resulting certificate. Canonical business/provider readback remains authoritative for the business outcome.
- Consumed contracts: exact versions declared by the journey, plus repository-authored evidence for positive, negative, failure, recovery and authoritative-readback cases.
- Published contract: `luzione-cross-system-journey-certification/v1`.
- Dependencies and mutation cone: API_SE_011 through API_SE_018; `integration`, `journeys`, `evidence`, `tests`, and additive catalog metadata only.
- Reuse/convergence: builds on the existing contract registry, evidence maturity model, failure taxonomy, release provenance, test taxonomy and causal navigation contracts. It creates no service, queue, table, schema or truth store.
- Invariants: all required repositories provide independent evidence; all candidate SHAs are exact; every required contract version is exercised; provider acknowledgement is not readback; unsupported claims are `QUARANTINED`.
- Non-scope: executing UI or Sultan code, deploying any repository, mutating provider state, or claiming a production journey.
- Acceptance proof: pass fixtures require exact independent evidence from all three repositories; known-bad producer-only, impersonated-consumer, missing-case and version-mismatch fixtures fail closed.
- Irreversible effects: none.

## Current evidence audit

The API repository contains API-authored handoff requests addressed to Luzione UI and Sultan OS. It contains no return artifact authored by either consumer with its exact candidate SHA and the required positive, negative, failure, recovery and authoritative-readback evidence. Therefore no representative journey is certified in this changeset. The unproven journey cone is recorded in `engineering/execution/journeys/API_SE_019_CERTIFICATION_20260829.json` and remains deliberately quarantined.

Strongest supportable claim before exact-head gates: `CONTRACT_STABLE | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM` for the certification contract; `NOT_ASSESSED | NOT_FINAL` for cross-system journey execution.
