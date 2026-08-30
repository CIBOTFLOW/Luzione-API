# Production Readiness Certification V1

Project: `API_SE_020`  
Canonical source: `src/modules/platform-readiness/certification.ts`  
Contract version: `luzione-production-readiness-certification/v1`

## Working contract

- Capability outcome: produce machine-readable and human-readable readiness certification by critical invariant while making unsupported production finality impossible to express as a pass.
- Actor/system entrypoint and end state: an exact release candidate plus invariant evidence enters the API-owned certification function and exits as `PRODUCTION_READY` only when every blocking invariant is supported by fresh production observation for that same candidate.
- Authoritative truth and write owner: the API owns certification semantics and its scorecard; each runtime, consumer, canonical store and provider owns its observation evidence. The scorecard never becomes a business truth store.
- Consumed contracts: readiness evidence, release provenance, security controls, recovery registry, SLI/SLO/error-budget semantics, performance program, test taxonomy, journey certification, proof ledger and failure ledger.
- Published contract: `luzione-production-readiness-certification/v1` plus the exact-candidate scorecard under `engineering/execution/readiness/`.
- Dependencies and mutation cone: terminal API_SE_019 outcome; `readiness`, `operations`, `docs`, `evidence`, additive catalog metadata and tests.
- Reuse/convergence: extends the existing readiness evidence law rather than adding a second health source, queue, table, schema or truth store.
- Invariants: every blocking item has an owner, exact evidence tier, candidate SHA, observation time, open failures, recovery posture and remaining uncertainty; local, preview, stale, SHA-mismatched, configured-only or quarantined evidence cannot produce `PRODUCTION_READY`.
- Non-scope: deployment, promotion, provider mutation, consumer-repository implementation or production observation.
- Acceptance proof: a fully fresh exact-candidate production fixture passes; local proof, SHA drift, staleness, open failures, incomplete recovery, uncertainty and environment mismatch fail closed.
- Irreversible effects: none.

The final scorecard is intentionally expected to be `NOT_READY` until deployed exact-SHA evidence, independent consumer journeys, authoritative readback, production recovery posture and current production observations exist.
