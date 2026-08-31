# API-PC-007 Working Contract

Capability outcome: expose an API-owned causal readback contract that distinguishes canonical command evidence, provider acknowledgement, authoritative source confirmation, missing evidence and stale evidence without introducing another truth store.

- Actor entrypoints: authenticated `GET /api/v1/platform-guarantees?receiptId=<receipt>` for an exact command chain and authenticated `GET /api/v1/catalog/shopify/projections` for the existing P113 projection page.
- Expected end state: an authorized consumer can identify the canonical owner, object/source version, observation time, freshness deadline, receipt/event/outbox/reconciliation lineage and strongest supportable finality. Missing or cross-tenant evidence is returned as missing and never leaks another tenant's existence.
- Authoritative truth: canonical Postgres P110 command receipts, event envelopes, outbox messages, delivery attempts and reconciliation checkpoints; P113 projection/sync relations remain authoritative only for the API-owned catalog read model while Shopify remains the source owner.
- Write owner: unchanged. This cell adds no mutation path, service, registry, queue, table or schema.
- Readback path: the existing platform-guarantees and P113 catalog projection endpoints, both behind credential-bound tenant/capability resolution.
- Consumed contracts: `luzione-command-ledger/v0.1`, `luzione-workflow-delivery/v0.1`, `luzione-reconciliation-state/v1`, `luzione-causal-navigation/v1`, API-PC-004 authenticated authority and P113 `2026-08-19.p113.v1`.
- Published contract: `luzione-causal-readback/v0.1`, additive-only until v1.
- Dependencies: API-PC-005; API-PC-006 evidence is reused when present but is not a scheduling dependency.
- Mutation cone: one pure contract module, two additive read response shapes, tenant-bound read queries, tests, registries and consumer handoffs.
- Reuse/convergence: extend `readPlatformGuaranteeSummary`, `listP113CatalogProjections`, desired/observed freshness semantics and causal navigation. Do not create a parallel projection or evidence database.
- Invariants: HTTP success is not business completion; provider acknowledgement is not business finality; `SOURCE_CONFIRMED` requires a source readback reference and timestamp; freshness is explicit and deterministic; stale source confirmation remains historical evidence but is not current confirmation; tenant scope comes only from authenticated actor context; unknown receipt and cross-tenant receipt are indistinguishable.
- Non-scope: business commands, provider calls, projection workers, source-system writes, consumer-repository implementation, production migration/deployment and production-observed finality.
- Acceptance proof: deterministic domain/provider/reconciling/source-confirmed/stale/missing derivation; tenant-bound query and route validation; P113 source/version/freshness response; disposable Postgres causal readback plus cross-tenant non-disclosure; full repository gates.
- Irreversible effects: none.
