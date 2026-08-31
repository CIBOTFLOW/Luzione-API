# Luzione API Production Convergence Program

Program extension: `LUZIONE_API_PRODUCTION_CONVERGENCE_V1`

Canonical live scheduler: `engineering/execution/NEXT_WORK.json`

Charter input: `Luzione_Production_Convergence_Implementation_Charter_2026-08-30.md`
Repository owner: `CIBOTFLOW/Luzione-API`

This program starts the API lane described by Section 20 of the production-convergence charter. The charter is planning context; repository instructions and evidence law remain authoritative for execution. `engineering/production-convergence/QUEUE.md` is a human-readable projection only and never a second scheduling authority.

## End state

Luzione API becomes the sole owner of new canonical business commands, invariants, events, durable workflow state, provider integration control, causal receipts and authoritative readback. Luzione UI remains the human workflow and presentation owner. Sultan OS remains the reasoning, tool, memory, evaluation and simulation owner. Canonical Postgres or an explicitly named provider remains business truth.

The convergence strategy is additive: inventory, stable contract, API-owned path, shadow readback, cohort canary, invariant comparison, reversible cutover, evidence window, then legacy retirement. No mass table move, destructive rewrite, provider credential change or microservice split is authorized.

## First cell working contract

- Projects: `API-PC-001`, bounded implementation portions of `API-PC-002` and `API-PC-003`.
- Capability outcome: publish the canonical program/ownership/dependency artifacts, a read-only exact release-identity surface, and contract bundle `luzione-api-contract/v0.1`.
- Entrypoint and end state: `GET /api/v1/release` returns bounded release, schema, contract and mutation-policy identity; consumers receive versioned artifacts under `contracts/`.
- Truth/write owner: this repository owns contract and release semantics. Vercel owns deployment observation. Migration application and UI/Sultan adoption remain independently evidenced.
- Reused paths: existing request identity, response, failure, readiness, release, receipt, service and truth registries; current Next.js/Vercel deployable; existing additive migration bundle.
- Mutation cone: additive documentation, JSON-compatible YAML registries, contract schemas, read-only route, catalog/topology metadata and tests.
- Invariants: mutations default off; local or incomplete deployment identity cannot become exact release proof; no consumer integration or production state is inferred from producer artifacts.
- Non-scope: canonical business mutations, new durable ledger tables, production migration application, provider effects, UI/Sultan edits, or production finality.
- Acceptance proof: registries are parseable and internally consistent; OpenAPI paths match the bounded v0.1 surface; exact preview fixture binds SHA/build/deployment; local and incomplete deployment fixtures remain visibly unbound; all repository gates pass.
- Irreversible effects: none.

## Release sequence

1. Merge the backward-compatible API contract and release identity.
2. Publish stable main-branch artifact paths and exact producer SHA.
3. UI and Sultan independently consume the same version and return consumer test evidence.
4. Deploy the API implementation dark/read-only and bind exact deployment evidence.
5. Only then advance authority, command and durable-ledger work in dependency order.

## Evidence posture

Wave 0 artifacts can reach `LOCAL_PROVEN` from repository gates. `API-PC-002` cannot reach `STAGING_PROVEN` or `PRODUCTION_PROVEN` without exact deployed observations. `API-PC-003` cannot claim consumer compatibility until UI and Sultan return independent exact-version tests.
