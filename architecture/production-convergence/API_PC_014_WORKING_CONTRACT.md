# API-PC-014 Working Contract — Production Operations Evidence

Project: `API-PC-014` — bind the existing telemetry, SLI/SLO, release, security and recovery contracts into one exact-candidate operational evidence package without manufacturing staging, managed-backup or production observations.

- Entrypoint: an offline API-owned evidence compiler/validator plus the additive public catalog registry for dashboard and alert definitions. It performs no deployment or provider action.
- Expected end state: every production-convergence runtime signal maps to a stable metric, dashboard panel, alert, SLO/runbook where applicable and exact-SHA evidence requirement; a candidate package reports the strongest supportable claim and enumerates every external blocker.
- Authoritative truth: exact release records, observed metric windows, security/readiness observations and restore/rollback receipts. Registry declarations and configured exporters are not observations.
- Write owner: `CIBOTFLOW/Luzione-API` owns the evidence contract, dashboard/alert registry, validator and local evidence artifact. Deployment providers, managed Postgres and independently operated consumers own their observations.
- Readback: `GET /api/v1/catalog` publishes bounded operational definitions; the offline evidence package and validator derive release readiness without exposing raw logs, credentials, tenant identifiers or business content.
- Consumed contracts: `luzione-telemetry/v1`, `luzione-slo-registry/v1`, `luzione-release-evidence/v1`, `luzione-release-identity/v0.1`, `luzione-recovery-registry/v1`, `luzione-security-controls/v1`, `luzione-production-readiness-certification/v1` and API-PC-013 RLS readiness.
- Published contract: `luzione-production-convergence-evidence/v0.1`, containing exact candidate/environment identity, dashboard/alert coverage, SLO windows, release gate, restore and rollback observations, deferred evidence and strongest claim.
- Dependencies: API-PC-002, API-PC-005 and API-PC-006 are complete. Existing telemetry/SLO/release/recovery registries are reused rather than replaced.
- Mutation cone: operational registry, evidence evaluator, JSON schema, catalog/service/contract metadata, tests, local restore/release evidence and runbook updates.
- Invariants: evidence IDs are unique; every observation binds an exact SHA and environment; dashboards reference registered metrics; alerts reference a runbook and stable metric; zero-tolerance security failures cannot consume an availability budget; local evidence cannot satisfy preview/production gates; a managed restore cannot be inferred from a local logical dump; rollback documentation is not rehearsal; production finality requires fresh exact-candidate production observation.
- Non-scope: configuring a telemetry exporter, creating a vendor dashboard, sending alerts, deploying or promoting a release, applying migrations, rotating credentials, exercising managed PITR, changing traffic, performing a production rollback or editing consumer repositories.
- Acceptance proof: registry completeness and known-bad sensitivity; exact-SHA local bundle with build/test/security and disposable restore evidence; local rollback/readback rehearsal; missing managed restore, preview canary/health/rollback, production SLO windows and production observation remain blocking; full repository gates.
- Irreversible effects: none. Managed restore, release, canary, rollback and production observation require named plans and separate authority.

Repository reality used to select this contract:

- Telemetry emits stable API, retry, reconciliation, queue and database metrics but no dashboard/alert registry consumes them.
- SLO targets are explicitly provisional and locally instrumented; there are no production rolling windows.
- The release contract already prevents local evidence from authorizing production promotion.
- The recovery registry and disposable restore harness prove only local logical portability; managed backup/PITR remains declared and unverified.
- The current production-readiness artifact is fail-closed and stale relative to recent convergence projects, so API-PC-014 produces a new exact-candidate bounded package rather than mutating historical evidence.
