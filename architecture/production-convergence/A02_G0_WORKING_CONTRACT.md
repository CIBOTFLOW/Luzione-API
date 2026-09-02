# A02 G0 Working Contract — Shared Identity, Command, Receipt and Readback Drafts

## Capability outcome

- Controller project: `A02` / lane `L1 API & Contracts`.
- Base candidate: A01 draft PR #57 at `9b5366266918ed4222acf54ce685bab15f6f104d`.
- Outcome: publish one API-owned, exact-version G0 draft bundle for identity, tenant, command, receipt and readback semantics, with compatibility adapters from the current runtime contracts and isolated persistence rehearsal.
- Truth limit: this work is a draft producer boundary. It is not integrated, production-ready, mutation-enabled or evidence that either consumer adopted the contracts.

## Entrypoint and expected end state

- Producer entrypoint: TypeScript draft constructors/adapters plus machine-readable JSON Schemas and a draft manifest.
- Consumer entrypoint: an explicit pin set for Luzione UI and Sultan OS; consumers adapt locally and must not fork or redefine the contracts.
- Expected G0 end state: current credential-bound identity, parsed domain commands, P110 receipts and causal readback can be projected losslessly or with named bounded limitations into the exact draft versions.

## Authoritative truth, write owner and readback

- Shared contract owner: `CIBOTFLOW/Luzione-API` only.
- Actor and tenant truth: verified credential/workload identity resolved by `src/lib/api/actor.ts`; client identity headers remain assertions only.
- Command/receipt truth: the existing P110 command ledger and atomic command kernel.
- Readback truth: tenant-bound canonical Postgres receipt/event/outbox/reconciliation rows through `luzione-causal-readback/v0.1`.
- Draft artifacts do not create a new truth store, identity store, command path, receipt table or readback endpoint.

## Consumed and published contracts

- Consumes `luzione-authority-subject/v0.1`, `luzione-request-identity/v1`, `luzione-command-ledger/v0.1`, `luzione-platform-receipt/v1` and `luzione-causal-readback/v0.1`.
- Publishes draft-only `luzione-identity-tenant/v0.2-draft.1`, `luzione-command-envelope/v0.2-draft.1`, `luzione-receipt-envelope/v0.2-draft.1`, `luzione-readback-envelope/v0.2-draft.1` and bundle `luzione-shared-contracts/v0.2-draft.1`.
- Compatibility is exact-pin, adapter-mediated and additive relative to current meanings. Unknown authority/effect/finality values fail closed.

## Dependencies and mutation cone

- G0 dependencies: none; controller authorization explicitly permits isolated drafting now.
- G1 dependencies: A01 and D01 must both satisfy G1 before A02 integration may be claimed.
- Mutation cone: `contracts/drafts`, a library-only adapter module, contract tests, consumer pin guidance, isolated validation scripts, proof/failure ledgers and handoff artifacts.
- Existing paths reused: API actor resolver, request identity envelope, lifecycle command kernel/types, P110 Postgres ledger, platform receipt and causal readback contracts.

## Invariants and explicit non-scope

- Clients cannot select actor, tenant, role, capability, authority, approval or effect authority.
- Credential actor and optional logical agent remain distinct and causally linked.
- Tenant scope must match across authenticated identity, command, receipt and readback.
- Same idempotency key plus different payload hash is conflict, never replay.
- Domain commit, provider acknowledgement and authoritative source readback remain distinct.
- The draft bundle grants no command activation or external effect authority and has no runtime route.
- No production migration, credential change, command activation, public promotion, consumer-repository edit or default-branch action is in scope.

## Acceptance proof defined before coding

1. Every JSON Schema and the draft manifest parse and publish the exact constants used by the TypeScript contract.
2. Adapters preserve request/correlation/trace, credential actor, logical actor, tenant, command, idempotency, payload hash, receipt, object version and readback evidence.
3. Actor/tenant/capability mismatches, stale pins, cross-tenant receipt/readback, command/receipt mismatch and acknowledgement-as-finality fixtures fail closed.
4. Both consumers receive exact pin guidance, compatibility limitations and required negative/return evidence.
5. A disposable fresh/upgrade P110 rehearsal preserves an existing v0.1 receipt, stores the draft version map only as metadata, proves `NO_EFFECT`, replay uniqueness, rollback and cross-tenant non-disclosure, then removes all proof resources.
6. Compliance, typecheck, lint, full tests and production build pass at the exact candidate SHA.

## Irreversible effects

- None. All code is library-only and all database work is synthetic/disposable.
- A02 integration, managed migrations, credentials, command activation, provider effects, public promotion and production rollback remain outside this candidate and require their declared gates.
