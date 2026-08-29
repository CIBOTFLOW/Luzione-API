# Luzione API Codex Instructions

Operate inside `CIBOTFLOW/Luzione-API` as the canonical deterministic platform-contract owner between Luzione UI, Sultan OS, canonical Postgres, durable workflows, and approved providers.

## Startup

Read these files before material work:

1. `START_HERE.md`
2. `engineering/execution/CURRENT_HANDOFF.json`
3. `engineering/execution/NEXT_WORK.json`
4. `docs/platform-engineering/SYSTEMS_ENGINEERING_PROGRAM_V1.md`
5. `docs/ARCHITECTURE.md`

The live API execution queue is `engineering/execution/NEXT_WORK.json`. Do not invent a second scheduling authority.

## Continuous execution

Select the highest-priority dependency-ready project. Normally form 1–3 tightly related projects into a cell and use at most two independent cells when mutation cones do not overlap. Continue automatically after each completed or quarantined cell. Do not stop for ordinary implementation questions, failing tests, merge conflicts, reversible migrations, provider/model/tool work, security/privacy/financial code, or reversible deployment work.

Stop only for:

- `S1_IRREVERSIBLE_EXTERNAL_EFFECT`: the next actual external/destructive effect lacks an already-tested path to restore materially equivalent internal and affected external state.
- `S2_MATERIAL_TRUTH_OR_PRODUCT_CONFLICT`: incompatible canonical meanings remain and repository evidence cannot select one safely.
- `S3_UNQUARANTINABLE_SYSTEM_FAILURE`: repair budget plus one strategy reset are exhausted and the defect threatens integrity or blocks all useful dependency-ready work and cannot be isolated.
- `S4_QUEUE_EXHAUSTED`: every admitted project is complete, deliberately quarantined, or removed and no dependency-ready work remains.

Cross-repository implementation is never performed implicitly. Produce a structured handoff for Luzione UI or Sultan OS instead of editing those repositories from this session.

## Canonical platform ownership

Luzione API owns the shared definitions of:

- command, event, receipt, readback and continuation contracts;
- request/actor/tenant/correlation identity envelopes;
- deterministic authorization and effect classification;
- platform failure taxonomy and retry semantics;
- desired/observed/reconciliation state semantics;
- service catalog, ownership, dependency and source-of-truth metadata;
- platform telemetry contracts, SLIs/SLOs and release evidence semantics;
- deployment provenance, rollback/readback expectations and readiness certification.

Luzione UI owns human-facing operational workflows and presentation. Sultan OS owns reasoning, models, agents, tools, memory, simulation and AI-quality governance. Neither may redefine an API-owned shared platform contract locally.

## Evidence maturity

Track these separately for every project and claim:

- engineering state: `SPECIFIED | CONTRACT_STABLE | IMPLEMENTED | BOUNDED_PASS | INTEGRATED_PASS`;
- release evidence: `NOT_ASSESSED | DEFERRED_EXTERNAL_INFRA | LOCAL_PROVEN | PREVIEW_PROVEN | PRODUCTION_OBSERVED`;
- effect authority: `NO_EFFECT | SANDBOX_ONLY | LIVE_EFFECT_AUTHORIZED`;
- finality: `NOT_FINAL | BOUNDED_CLAIM | RELEASE_CANDIDATE | PRODUCTION_OBSERVED_FINAL_FOR_SCOPE`.

A claim is never production-final merely because unit, integration, mock, local, CI, preview, or synthetic evidence passed. Record every unexercised boundary in the proof ledger.

## Project contract before code

Before material implementation, compile current repository reality and the relevant project entry into a concise working contract containing:

- project ID and capability outcome;
- actor/system entrypoint and expected end state;
- authoritative truth, write owner and readback path;
- consumed and published contracts;
- dependencies and mutation cone;
- paths to reuse, converge or retire;
- invariants and explicit non-scope;
- acceptance proof defined before coding;
- irreversible effects, if any.

Do not create a new service, registry, queue, table, schema, truth store or compatibility layer until existing ownership has been inspected and cannot be extended cleanly.

## Proof law

For a deterministic platform capability, prove the narrow claim through:

```text
real authenticated/system entrypoint
→ actor + tenant + purpose boundary
→ typed contract
→ canonical owner
→ durable receipt/event/checkpoint when applicable
→ authoritative readback
→ negative/failure/recovery case
→ test-sensitivity evidence
```

At release boundaries also bind evidence to the exact candidate SHA and environment. Provider acknowledgement alone is not business completion. HTTP 200 alone is not business completion. UI rendering is never source-of-truth proof.

## Failure accounting

Every material failure, contingency, skipped external proof, test exhaustion, ambiguous provider result, rollback uncertainty or quarantine must be recorded in `engineering/execution/SYSTEMS_ENGINEERING_FAILURE_LEDGER.json`.

Do not overwrite failure history to make the project appear clean. Resolved failures remain recorded with a resolution reference.

Default repair budget:

```text
1 symptom patch
2 root-cause attempts
1 strategy reset
then quarantine the affected dependency cone when possible
```

## Proof accounting

Update `engineering/execution/SYSTEMS_ENGINEERING_PROOF_LEDGER.json` at every project boundary. Explicitly record:

- what was actually exercised;
- what was inferred but not exercised;
- exact SHA and environment;
- authoritative evidence references;
- known failures/quarantines;
- deferred external infrastructure;
- remaining uncertainty;
- the strongest supportable claim and no stronger.

## API contract evolution

Shared contracts must be machine-readable where practical, versioned, backward-compatible by default, and governed by explicit compatibility rules. Prefer additive evolution. Breaking changes require a new contract version, consumer inventory, migration/cutover plan, dual-read/dual-write only when justified, and removal criteria for the old path.

One domain outcome must have one canonical mutation path. One shared semantic concept must have one canonical definition.

## Status and handoff

After a project/cell, report:

```text
done | engineering state | release evidence | effect authority | finality | proof | failures/quarantine | deferred external infra | remaining uncertainty | next
```

Before ending a session, update `engineering/execution/CURRENT_HANDOFF.json` with exact next projects, next action, proof remaining, failures/quarantines, external dependencies, cross-repo handoffs and any stop code.