# API-STAGE5-001 working contract — Sultan authority and outcome boundary

## Capability outcome

Advance the API-owned Sultan boundary from an evaluate-only intent contract into a
durable, fail-closed Stage 5 authority and outcome-observation plane. The plane
must bind every admitted or denied Sultan operation to the verified workload,
server-derived tenant, exact logical-agent registration, exact Sultan interaction
and participation-context hashes, exact deployment SHAs, canonical evidence and
policy version. It must never turn model text, Knowledge, memory, feedback or a
caller assertion into authority.

## Entrypoints and expected end state

```text
verified Sultan OS or Luzione UI Vercel OIDC workload
-> pre-inference v0.1 identity/policy evaluation over exact canonical receipt refs
-> Sultan model inference and immutable interaction receipt
-> post-inference Stage 5 participation/admission assertion parser
-> immutable no-effect admission or denial receipt
-> bounded fact/calculation readback or separately reviewed command path
-> later immutable outcome observation and authenticated lineage readback
```

The existing `/api/v1/sultan/tools`, tool invocation, command preparation,
execution and effect-readback routes remain the bounded tool surface. Stage 5
adds a prerequisite admission receipt and canonical readback/outcome contracts;
it does not grant a new mutation or provider path.

## Ownership and source of truth

- Sultan OS owns Sultan's identity/participation schema, reasoning, model calls,
  memory and developmental learning.
- Luzione UI owns authenticated human conversation/feedback UX and server-side
  assembly of Sultan-conforming grounding packets.
- Luzione API owns workload and tenant identity, logical-agent registration,
  capability/purpose/case/effect admission, immutable API receipts, canonical
  business readbacks and outcome observation semantics.
- Canonical Postgres tables or a named authoritative provider own business facts.
- A receipt records an authority decision; it is not itself a business fact or
  proof that a recommendation worked.

## Consumed and published contracts

- Consumes the final exact Sultan participation/grounding contract version and
  repository SHA supplied by `CIBOTFLOW/Sultan-OS`; until supplied, this field is
  an explicit unresolved pin and cross-repository integration cannot pass.
- Consumes `luzione-authority-subject/v0.1`, `luzione-request-identity/v1`, the
  API-PC-012/016 agent registry, the A02 exact five-pin draft bundle, existing
  canonical domain readbacks and `luzione-sultan-tool-*/v1`.
- Publishes `luzione-sultan-api-admission/v1`,
  `luzione-canonical-business-readback/v1` and
  `luzione-sultan-outcome-observation/v1` with JSON Schemas and a machine-readable
  consumer handoff.

## Invariants

- Only exact verified Sultan OS and Luzione UI Vercel OIDC workload identities
  are accepted for Stage 5 readback and outcome routes; configured service-token
  identities are denied. Tenant and credential actor always come from the
  credential adapter.
- A client may assert exact interaction/context/grounding/evidence/SHA references
  for verification, but may not supply tenant, actor, role, capability grant,
  policy decision, approval, allowed effect, memory, instruction or evidence
  content.
- Exact logical agent ID, registered version, capability, purpose, case type and
  effect ceiling are verified server-side. Unknown combinations deny.
- Grounding and evidence are treated as untrusted data. Prompt-like content is
  rejected at this boundary; references never grant authority.
- Sultan OS and UI release SHAs must match server-configured exact pins and the
  API release SHA is derived server-side. Missing or mismatched pins deny.
- Admission and denial receipts are append-only, content-hashed, tenant-bound and
  idempotent. Exact replay returns the same receipt; key reuse with changed
  material records a conflict and denies.
- Reasoning, simulation, approval, execution and observation are separate phases.
  The v0.1 agent-intent endpoint is the pre-inference policy gate. The Stage 5
  admission endpoint requires the real final interaction receipt, runs only
  post-inference and never authorizes inference, approval, execution or outcome.
- Canonical readbacks contain structured `FACT` or `CALCULATION` claims only,
  each with source/version/freshness/provenance. Unsupported or unavailable
  entities return an explicit unavailable status, never an invented fact.
- Outcome observations bind one exact prior admission receipt and independent
  source/readback evidence. Provider acknowledgement alone cannot confirm an
  outcome. Observations include the API SHA and immutable admission/run/
  interaction/context lineage. An authenticated tenant-bound GET readback
  reloads the admission and canonical evidence and verifies the receipt hash;
  the unkeyed hash alone does not prove API origin. Observations are append-only;
  supersession is explicit.
- A structured outcome expectation is an authenticated Sultan post-inference
  assertion bound into the admission and outcome hashes. The API validates and
  compares it, but cannot independently prove that Sultan extracted it from the
  immutable model interaction until Sultan integrates a receipt-verification
  proof. The receipt exposes this limit as
  `verifiedAgainstInteractionReceipt=false`.
- Recommendations and simulations remain `NO_EFFECT`. A1 requires an exact
  reviewed human admission; A2/A3 remain governed by their existing exact policy
  or approval path. Sultan receives no implicit production authority.
- Raw prompts, raw model responses, secrets and credentials are prohibited from
  all three Stage 5 tables.

## Acceptance proof defined before coding

1. Parser and evaluator tests cover exact Sultan/UI workload binding, registered
   agent/capability/purpose/case/effect, exact SHA pins and prerequisite hashes.
2. Adversarial cases fail closed for forged identity, wrong tenant, stale or
   mismatched evidence, replay conflict, missing approval, privilege escalation,
   prompt injection, provider failure and deployment-SHA drift.
3. Exact replay yields one admission receipt; changed-payload reuse yields a
   durable conflict without changing the original receipt.
4. Disposable PostgreSQL fresh and observed-upgrade rehearsals prove migration
   order, constraints, forced RLS, no browser/service-role grants, cross-tenant
   non-disclosure, append-only denial, rollback/forward recovery and exact
   readback.
5. Canonical readback fixtures exercise orders, shipments, accounts,
   opportunities, commitments, logistics, economics and FEP allocation. Missing
   canonical owners stay `UNAVAILABLE` rather than being fabricated.
6. Outcome observations prove all four classifications, exact predecessor
   binding, stale/mismatched/source-ack denial, immutable supersession, full
   admission lineage and authenticated origin readback. Service-token
   impersonation fails before Stage 5 storage.
7. Compliance, strict TypeScript, lint, full tests, security tests, build and
   zero-vulnerability audit pass at an exact candidate SHA.

## Release and irreversible-effect gate

- Implementation, contract publication and disposable rehearsals are authorized.
- Production DDL is blocked unless the exact Supabase project, named accessible
  backup receipt and restore/PITR window, migration inventory, successful
  disposable and recovery rehearsals, principal authority, forced RLS/tenant
  negatives, no concurrent writer, exact merged main SHA and green CI are all
  recorded.
- The observed physical restore point timestamp without a backup receipt ID or
  exercised restore does not satisfy this gate. Continuous PITR is disabled.
- Production deployment/promotion is blocked because the connected Vercel
  account exposes no Luzione API project. Local or protected-preview evidence is
  not production proof.
- No production DDL, credential change, provider effect, public promotion or
  default-branch action is authorized by this working contract.
