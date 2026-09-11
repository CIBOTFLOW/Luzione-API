# SGO-V02 working contract — object authorization proof

## Outcome

Publish the smallest API-owned, provider-free authorization matrix and unmounted evaluator proving that an unauthorized credential-bound service actor or tenant cannot read, resume, mutate, or receive cached object results. End-user actor/object authorization is not producible by the pinned API credential boundary and remains an explicit integration hold. Preserve every existing route and contract; do not imply cross-repository integration.

## Entry point and end state

- Entry point: an internal caller supplies a process-local attestation produced only after `resolveVercelWorkloadIdentity` cryptographically verifies a token for pinned `service:luzione-ui` or `service:sultan-os`, plus the requested surface/operation/object ID and a server-resolved object authorization scope. Cached-result release additionally requires a server-internal exact cache binding created only after an authorized read; actor, scope and binding are not accepted from an HTTP body.
- End state: `ALLOW`, fail-closed `DENY`, or explicit `INTEGRATION_HOLD`. The evaluator returns authorization metadata only. A cached-result helper returns the payload only for `ALLOW` and returns `null` for every denial or hold.
- Runtime state: unmounted contract proof. No new HTTP route, cache, adapter, table, queue, migration, or provider integration.

## Reconciled ownership

| Surface | Observed owner/runtime | V02 posture |
| --- | --- | --- |
| Linked Task/Commercial Case/Quote/Product/Supplier context | API C03 source-port contract, unmounted | Service-workload proof row for pinned Luzione UI identity; exact actor, tenant, capability, surface, object, version, authorization version, and cache binding required |
| Stage 5 canonical context | API authenticated route and tenant-bound store | Service-workload proof row for pinned callers; existing runtime is preserved and V02 is not mounted |
| Sultan command reservation/effect readback | API authenticated routes/service and tenant-bound store | Service-workload proof row for pinned Sultan OS identity and read/resume/mutate/cached-result operations; no command is executed |
| Chat attachments | Luzione UI routes and stores | End-user integration hold; the pinned API cannot produce the UI session user identity |
| Conversation threads | Luzione UI chat/session paths and Sultan OS runtime | End-user integration hold; the pinned API cannot produce the UI session user identity and consumer integration is unproven |
| Evidence/document exports | Luzione UI routes and services | End-user integration hold; the pinned API cannot produce the UI operator identity or mint export delivery authority |

The public API workflow catalog is intentionally outside this object matrix: it carries static non-object definitions and is the only observed API route overriding the default `no-store` response policy.

## Consumed contracts and source truth

- Reuse the exact signed-workload resolver and credential-derived tenant/capability semantics from `src/lib/api/actor.ts`; only the two allowlisted Vercel service identities are credited by this proof.
- Reuse the API response default `cache-control: no-store` from `src/lib/api/http.ts`.
- Reconcile C03 linked context, Stage 5 readback, Sultan command/effect service and tenant-scoped Postgres paths without editing or mounting them.
- Object authorization scope is server-resolved evidence for this draft. It is not accepted from an HTTP body and is not a new canonical truth store.
- UI and Sultan OS sources are exact read-only evidence pins and remain integration owners for their local surfaces.

## Invariants

1. Only a process-local attestation created by successful signed-workload verification for `service:luzione-ui` or `service:sultan-os` can enter an API proof row. Raw, fictional, copied or serialized `ApiActor` values fail closed.
2. The authenticated service actor, tenant, capabilities, surface-bound object scope, authorization version, and cache binding cannot be selected or broadened by cached payload content.
3. An API proof row allows only an operation named in its matrix and only with its exact required capability.
4. Object release requires exact tenant equality, exact surface equality, exact requested/resolved object identity, and service actor ownership or an explicit service actor grant.
5. A cache binding is created only after an authorized read and binds actor, tenant, surface, object ID, object version, authorization source citation, authorization version, payload hash, creation and expiry.
6. Actor, tenant, surface, object, version, authorization, payload-hash, binding-hash, future-time, or expiry drift denies cached-result release and returns no payload.
7. End-user attachment, thread and export authorization can return only `INTEGRATION_HOLD`; names, pins, credentials or apparent local controls cannot promote it to API-proven authorization.
8. The evaluator grants no effect, mutates no business state, performs no read/write/provider call, and cannot produce G1/G2 evidence.

## Mutation cone

- Add one isolated authorization-proof module and focused tests.
- Add the machine-readable SGO-V02 matrix, this contract, taxonomy entry, proof ledger and handoff.
- Do not modify existing identity, C03, Stage 5, command, receipt, route, cache, schema, or migration code.

## Acceptance proof

- The matrix has exactly the five requested surface kinds with all non-API rows held.
- Locally signed tokens resolve through the pinned verifier to exactly `service:luzione-ui` and `service:sultan-os`; wrong project claims, a fictional user actor and a copied attestation fail closed.
- Credential-bound service owner/read, action resume/mutate and exact cache release pass.
- Cross-tenant, second real service actor, surface/object mismatch, missing capability, unsupported operation, malformed scope and every cache-binding drift fail closed.
- A second explicitly granted credential-bound service actor still cannot receive the first actor's cached payload.
- Expired cache can recover only through a newly authorized read and newly bound cache envelope; the old envelope stays denied.
- Focused, repository-wide, type, lint, compliance, build, source-pin and reverse/reapply checks pass at exact SHAs.

## Explicit non-scope

- No runtime mounting or route activation.
- No user-session propagation into existing service-to-service routes.
- No end-user identity resolver or end-user authorization claim.
- No attachment, thread, export, action, receipt, cache or object persistence.
- No provider call, deployment, production mutation, migration application, default-branch action, legacy A02 execution, or G1/G2 claim.
