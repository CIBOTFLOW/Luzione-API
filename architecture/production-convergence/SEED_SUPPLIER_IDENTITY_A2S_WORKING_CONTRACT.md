# SEED-SUPPLIER-IDENTITY-A2S working contract

## Outcome and entrypoints

The API owns a tenant-bound, Account-backed `SupplierProfile/v1` eligibility fact and a separate Portal organization-to-Account access projection. Authenticated clients submit exact versioned commands or read the resulting owner projection through `/api/v1/supplier-profiles`, `/api/v1/accounts/:accountId/supplier-profile`, and `/api/v1/supplier-portal-account-bindings` routes.

Successful commands finish as internal `DOMAIN_COMMITTED` P110 receipts with authoritative owner readback and `TimelineEvent/v1`; they authorize no provider or external effect. Canonical reads and proposed writes have separate default-off tenant admission gates.

## Truth and ownership

- CRM Account remains canonical organization identity. `SupplierProfile/v1` references an exact same-tenant Account ID/version and never copies Account truth.
- Luzione API is the only writer for append-only Supplier Profile and Portal binding version facts.
- Portal organization, membership, and object-grant state is external access metadata only. It cannot confer supplier eligibility.
- Eligibility is valid only when the stored profile is `ELIGIBLE`, the Account version remains current, the requested capability is approved, and the requested observation is inside the canonical validity window.
- Duplicate/conflicting identities remain proposed review work and cannot activate.

## Authority and mutation invariants

- Proposal and revision require an actual signed same-tenant human proposer, A1/ALLOW, exact evidence, expected version, idempotency, P110 receipt, and readback.
- Activation, suspension, expiration, revocation, and archive require a distinct signed same-tenant human, A2/REQUIRE_HUMAN, and exact prior version. A proposer cannot approve their own eligibility.
- Portal binding record/revoke requires the exact Portal workload identity plus a distinct credential-bound human approval. No Vercel Portal caller is admitted by this package; direct-store proof uses only a disposable service-token test identity.
- The runtime role may only select and insert owner facts. Forced tenant RLS, append-only triggers, deferred exact P110 receipt checks, and a guarded rollback preserve ownership.

## Reuse, dependencies, and non-scope

The slice reuses canonical `public.accounts`, A3 `EvidenceArtifact/v1`, the P110 command/event/outbox ledger, Core authority/mutation/receipt boundaries, and `TimelineEvent/v1`. A3 RFQ-to-selection and PO dependency holds remain unchanged until a separate controller-reviewed correction integrates `requireEligibleSupplier`; A2P Proposal ownership remains absent.

No Portal invite/login implementation, Portal credential admission, managed migration, deployment, RFQ send, PO release, email, payment, vendor commitment, or other live effect is in scope.

## Acceptance proof

Consumer parsers and positive HTTP fixtures must preserve independent A1 seed-product, A2 schedule, A3 procurement, A2S supplier-identity, and runtime release identities. Focused/full tests and a disposable PostgreSQL rehearsal must prove exact replay, changed-payload rejection, stale/version/tenant/capability denial, human activation, self-approval denial, concurrent single winner, atomic rollback, suspended/expired/revoked denial, Portal lineage/revocation/organization uniqueness, forced RLS, pre-admission rollback/reapply, post-admission rollback refusal, and zero effects.
