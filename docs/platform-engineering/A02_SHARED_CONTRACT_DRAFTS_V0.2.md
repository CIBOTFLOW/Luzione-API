# A02 Shared Contract Drafts v0.2

Status: `G0_DRAFT_ONLY`

Owner: `CIBOTFLOW/Luzione-API`

Runtime activation: `false`

Effect authority: `NO_EFFECT`

This bundle converges the existing API-owned identity, tenant, command, receipt and readback meanings behind exact-version draft schemas and adapters. It does not replace the current runtime contracts, add a route, activate a command, apply a migration or prove consumer integration.

## Exact consumer pins

Consumers must pin all five identifiers together:

```text
luzione-shared-contracts/v0.2-draft.1
luzione-identity-tenant/v0.2-draft.1
luzione-command-envelope/v0.2-draft.1
luzione-receipt-envelope/v0.2-draft.1
luzione-readback-envelope/v0.2-draft.1
```

The machine-readable bundle is `contracts/drafts/luzione-shared-contracts-v0.2-draft.1.manifest.json`. The executable producer adapters are `src/modules/shared-contract-drafts/contracts.ts` and `src/modules/shared-contract-drafts/adapters.ts`. The strict consumer-side compatibility boundary is `src/modules/shared-contract-drafts/consumerCompatibility.ts`, and the shared field-level fixture is `contracts/drafts/fixtures/a02-v0.2-draft.1-producer-consumer.json`.

## Compatibility and adapter law

- `luzione-authority-subject/v0.1` plus `luzione-request-identity/v1` adapt to the identity/tenant draft only after credential actor, tenant and capability are server-bound.
- `luzione-command-ledger/v0.1` adapts to the command draft with the same command, correlation, tenant, idempotency, payload hash, target and policy version.
- Current lifecycle and platform receipts adapt to the receipt draft without granting effect authority.
- `luzione-causal-readback/v0.1` adapts to the readback draft while provider acknowledgement remains non-final and only fresh authoritative source confirmation may be business-final.
- Unknown identity, authority, effect, receipt state, finality or freshness values fail closed.
- Consumers must reject surplus and missing fields, any non-exact version, cross-tenant linkage, stale business-final claims, same-key payload drift, and any command or receipt that attempts to introduce effect authority.
- Draft fields may not be copied into a consumer-owned canonical contract. Consumers own only their local adapter and presentation/runtime behavior.

## Luzione UI consumption

Luzione UI may map its authenticated request boundary and receipt/readback presentation to the exact pins. It must not send actor, tenant, capability, authority, approval or effect authority as caller-selected truth. Required return evidence includes pin validation, unauthorized/cross-tenant denial, duplicate/replay behavior, stale readback behavior, and a UI-authored exact-SHA handoff.

## Sultan OS consumption

Sultan OS may map its verified workload actor and logical agent through a Sultan-local adapter. The credential actor and logical actor must remain separate, the exact tenant comes from the verified workload boundary, and execution remains `NO_EFFECT`. Required return evidence includes exact pin validation, unknown/stale abstention, cross-tenant and workload-delegation denial, zero business writes, and a Sultan-authored exact-SHA handoff.

## Gate boundary

A01 and D01 must both meet G1 before A02 integration can be claimed. A preview, local adapter, synthetic rehearsal, passing build or consumer branch does not make this draft integrated or production-ready.
