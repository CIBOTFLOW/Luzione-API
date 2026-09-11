# SGO-V03 bounded working contract

- Program/package: `SGO-20260911-01` / `SGO-V03`.
- Capability outcome: publish the smallest API-owned, provider-free business-event reducer that makes one released action, one effect reservation, one first dispatch observation, ordered delivery, reconciliation and source-confirmed finality explicit.
- Entry point/end state: an unmounted library consumer supplies a pre-existing released-action receipt, exact approval/source observation, prior reducer state and one event; the reducer returns an accepted, replayed, deduplicated or rejected receipt without executing an effect.
- Authoritative truth: the action's named canonical domain owner owns the record and version; an exact named source readback alone may establish bounded business finality.
- Write owner/readback: `CIBOTFLOW/Luzione-API` owns this draft boundary. It has no store, route or runtime writer. Future consumers must atomically persist state and read the named canonical source; that integration is held.
- Consumed contracts: the accepted V02 base `055bdaf20536c27cb8c016cbcd33c6f1fba52785`; existing command-ledger idempotency, workflow-delivery reconciliation, causal readback, exact-version approval/order and Sultan action reservation semantics; accepted SGO-C04 exact head `22d09b9d06fc60c79a0bcfa0c49a2f6967574cb0` as discovery-only evidence.
- Published contract: `luzione-business-event-boundary/v0.1-draft` and its machine-readable evidence matrix.
- Dependency/mutation cone: C04 remains a G1 consumer-integration dependency. Mutation is limited to the new pure module/tests, the evidence matrix, test taxonomy and repository-local proof/handoff records.
- Reuse/convergence: transport replay binds both transport event ID and business event ID; stale sequence is distinct from a future sequence gap; existing provider acknowledgement remains non-final; ambiguity blocks a second dispatch observation until exact source reconciliation.
- Invariants: C04 discovery never grants authority; approval binds tenant/action/operation/payload/policy/source version; approval and current source are rechecked before release and first dispatch; one action produces at most one stable reservation and one first-dispatch observation; exact replay returns the original receipt; only exact source readback is business-final; every result is `NO_EFFECT` and `grantsAuthority=false`.
- Non-scope: route/runtime mounting, persistence, consumer adoption, credential/approval attestation, provider calls, sends, order creation, other business effects, migration application, deployment, production mutation, default-branch work, legacy A02, G1 or G2.
- Acceptance proof: communication-send, order-create and other-effect matrices; exact replay after approval expiry; duplicate transport delivery; identity conflict; future/stale sequence; stale/missing/drifted approval source; ambiguity plus blocked redelivery; provider-ack non-finality; exact readback recovery; forged evidence/type phase; corrupt state; exact source pins and unmounted-boundary checks.
- Irreversible effects: none. Rollback is the reverse of the bounded branch diff; no database/provider/external restore is applicable.

Strongest supportable claim: `BOUNDED_PASS / LOCAL_PROVEN / NO_EFFECT / BOUNDED_CLAIM`. Runtime, durable concurrency, C04 consumption, authenticated preview and production behavior remain unexercised.
