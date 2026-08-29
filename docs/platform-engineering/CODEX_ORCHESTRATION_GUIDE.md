# Three-Repository Codex Orchestration Guide

This guide is for the human operator running separate Codex sessions in Luzione API, Luzione UI and Sultan OS.

## Branches and prompts

### Luzione API
- Branch: `codex/systems-engineering-program-v1`
- Prompt: `engineering/execution/PROMPT_LUZIONE_API_SYSTEMS_ENGINEERING_V1.md`
- Role: canonical shared contract and platform-reliability owner.

### Luzione UI
- Branch: `codex/systems-engineering-program-v1`
- Prompt: `engineering/execution/PROMPT_LUZIONE_UI_SYSTEMS_ENGINEERING_V1.md`
- Role: human-facing operational consumer and journey evidence owner.

### Sultan OS
- Branch: `codex/systems-engineering-program-v1`
- Prompt: `engineering/execution/PROMPT_SULTAN_SYSTEMS_ENGINEERING_V1.md`
- Role: AI runtime/model/tool/evaluation consumer and AI operational-evidence owner.

## Recommended launch order

1. **Start API first.** Let it reconcile `API_SE_001` and begin the contract/truth inventory. API is the only session allowed to define shared contract semantics.
2. **Start UI and Sultan soon after, in parallel.** Their first project is a reality inventory/reconciliation project and does not require the full API program to be finished.
3. UI/Sultan may continue repo-local work that does not depend on an unpublished API contract. They must quarantine only the dependent slice when the contract is not stable.
4. As API projects reach a stable consumable boundary, API emits structured handoffs. UI/Sultan consume the exact published version and record their independent proof.
5. UI/Sultan emit consumer handoffs back to API. Producer proof never counts as consumer integration proof.
6. API performs cross-system certification only after it has real consumer evidence.

## Contract wave sequence

### Wave 1 — reality and semantic ownership
- API: `API_SE_001`–`API_SE_003`
- UI: `LUZIONE_SE_001`
- Sultan: `SULTAN_SE_001`

Outcome: the system knows what already exists, who owns it and where duplicate/ambiguous truth may exist.

### Wave 2 — identity, failures, receipts and state
- API: `API_SE_004`–`API_SE_007`
- UI: `LUZIONE_SE_002`–`LUZIONE_SE_006` as relevant contracts stabilize
- Sultan: `SULTAN_SE_002`–`SULTAN_SE_005`

Outcome: all systems speak one language for correlation, failure, action/readback evidence and desired/observed state.

### Wave 3 — observability and operating model
- API: `API_SE_008`–`API_SE_011`
- UI: `LUZIONE_SE_007`–`LUZIONE_SE_009`
- Sultan: `SULTAN_SE_006`–`SULTAN_SE_007`

Outcome: traces, service ownership, SLOs, business/AI SLIs and production-truth status become evidence-backed.

### Wave 4 — release, capacity, recovery and security
- API: `API_SE_012`–`API_SE_015`
- UI: `LUZIONE_SE_010`–`LUZIONE_SE_011`
- Sultan: `SULTAN_SE_008`–`SULTAN_SE_009`

Outcome: exact release provenance, measured capacity, recovery drills and zero-tolerance security evidence.

### Wave 5 — accessible surfaces and certification
- API: `API_SE_016`–`API_SE_020`
- UI: `LUZIONE_SE_012`
- Sultan: `SULTAN_SE_010`–`SULTAN_SE_012`

Outcome: API engineering portal, causal human/AI control surfaces, cross-system journeys and truthful readiness certification.

## Concurrency rule

Do not try to synchronize the three Codex sessions by clock time. Synchronize them by **contract version and evidence handoff**.

A consumer may proceed when the exact artifact it consumes is stable enough, even if the producer project has not reached production evidence. Conversely, a producer project being `COMPLETE` does not prove a consumer is integrated.

## Handoff acceptance

A cross-repo handoff is consumable when it names:

- producer repository and exact SHA;
- contract name/version/path;
- exact semantics expected of the consumer;
- compatibility posture;
- producer evidence;
- known limitations;
- acceptance proof required from the consumer;
- remaining uncertainty.

## Failure behavior

Every session keeps its own failure/proof ledger. If one repository discovers a shared-contract defect:

1. record the local failure;
2. quarantine only affected work;
3. emit a handoff to the semantic owner;
4. continue independent work;
5. do not create a local fork to bypass the defect.

## What the human should not have to coordinate

The human operator should not need to:

- merge every small project manually;
- decide ordinary retries/fixes;
- translate failure semantics among repositories;
- tell a consumer which exact contract version to use;
- remember which proof was local vs preview vs production;
- reconstruct failure history from chat;
- decide whether a test failure can be quarantined.

The repository governance, queue, handoffs, proof ledgers and failure ledgers should carry that continuity.

## Human stop conditions

The sessions should surface a human decision only for the S1–S4 conditions defined in their AGENTS/queues, with the exact blocked action and evidence. Ordinary implementation ambiguity, CI failure, reversible deployment, provider/tool work or cross-repo dependency waiting should not become a manual stop.

## Final rule

The program is successful when a new engineer can inspect the registries/control surfaces and answer:

- what components exist;
- who owns each one;
- what truth each controls;
- how requests/actions are correlated;
- why a state exists;
- what failed and whether retry is safe;
- what was actually executed and read back;
- what SLO is breached;
- how the system scales and recovers;
- which exact release is running;
- what is genuinely production observed;
- what is still uncertain.

No AI explanation should be required to reconstruct these basics.