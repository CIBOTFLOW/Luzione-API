# Universal Receipt and Lineage V1

Project: `API_SE_006`  
Canonical source: `src/modules/platform-contracts/receiptContract.ts`  
Contract version: `luzione-platform-receipt/v1`

## Working contract

The V1 receipt is an immutable, addressable evidence record for `decision`, `action_intent`, `execution`, `readback`, `recovery` or `release`. It binds request/correlation/trace identity, server-derived actor/tenant/purpose/capability/authority, input and policy versions, idempotency, requested and actual effects, outcome, failure, cost/latency, release SHA and predecessor receipt IDs.

The evidence laws are fail closed:

- a decision or intent cannot claim an actual effect, acknowledgement or readback;
- an execution acknowledgement cannot populate source readback;
- a readback requires an authoritative source reference, observation time and actual observed effect;
- a model reference is metadata and cannot be used as an authoritative input version;
- predecessor IDs form explicit lineage rather than overwriting earlier receipts.

The adapter for the existing lifecycle command receipt describes its exact bounded truth: the canonical owner mutation committed, the event acknowledges that commit, and outbox dispatch is still pending. It does not invent provider execution or readback.

## Maturity and non-scope

The contract and adapters are locally proven library code. Durable receipt-store activation remains `LIBRARY_ONLY` and is intentionally not promoted from draft PR #31. This project does not execute effects, migrate a store, claim consumer integration or claim production evidence.

Strongest claim: `CONTRACT_STABLE | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.
