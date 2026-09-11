# SGO-V02 working contract — object authorization proof

## Outcome

Publish the smallest API-owned, provider-free authorization matrix and unmounted evaluator proving that an unauthorized actor or tenant cannot read, resume, mutate, or receive cached object results. Preserve every existing route and contract; do not imply cross-repository integration.

## Entry point and end state

- Entry point: an internal caller supplies an already authenticated `ApiActor`, the requested surface/operation/object ID, and a server-resolved object authorization scope. Cached-result release additionally requires a server-internal exact cache binding created only after an authorized read; neither scope nor binding is accepted from an HTTP body.
- End state: `ALLOW`, fail-closed `DENY`, or explicit `INTEGRATION_HOLD`. The evaluator returns authorization metadata only. A cached-result helper returns the payload only for `ALLOW` and returns `null` for every denial or hold.
- Runtime state: unmounted contract proof. No new HTTP route, cache, adapter, table, queue, migration, or provider integration.

## Reconciled ownership

| Surface | Observed owner/runtime | V02 posture |
| --- | --- | --- |
| Linked Task/Commercial Case/Quote/Product/Supplier context | API C03 source-port contract, unmounted | API proof row; exact actor, tenant, capability, object, version, authorization version, and cache binding required |
| Stage 5 canonical context | API authenticated route and tenant-bound store | API proof row; existing runtime is preserved, V02 evaluator is not mounted |
| Sultan command reservation/effect readback | API authenticated routes/service and tenant-bound store | API proof row for read/resume/mutate/cached-result operations; no command is executed by this package |
| Chat attachments | Luzione UI routes and stores | Integration hold; API does not claim authorization or runtime ownership |
| Conversation threads | Luzione UI chat/session paths and Sultan OS runtime | Integration hold; actor-level consumer integration is unproven |
| Evidence/document exports | Luzione UI routes and services | Integration hold; API does not mint export URLs or delivery authority |

The public API workflow catalog is intentionally outside this object matrix: it carries static non-object definitions and is the only observed API route overriding the default `no-store` response policy.

## Consumed contracts and source truth

- Reuse `ApiActor` and credential-derived tenant/capability semantics from `src/lib/api/actor.ts`.
- Reuse the API response default `cache-control: no-store` from `src/lib/api/http.ts`.
- Reconcile C03 linked context, Stage 5 readback, Sultan command/effect service and tenant-scoped Postgres paths without editing or mounting them.
- Object authorization scope is server-resolved evidence for this draft. It is not accepted from an HTTP body and is not a new canonical truth store.
- UI and Sultan OS sources are exact read-only evidence pins and remain integration owners for their local surfaces.

## Invariants

1. The authenticated actor, tenant, capabilities, object scope, authorization version, and cache binding cannot be selected or broadened by cached payload content.
2. An API proof row allows only an operation named in its matrix and only with its exact required capability.
3. Object release requires exact tenant equality, exact requested/resolved object identity, and actor ownership or an explicit actor grant.
4. A cache binding is created only after an authorized read and binds actor, tenant, surface, object ID, object version, authorization source citation, authorization version, payload hash, creation and expiry.
5. Actor, tenant, surface, object, version, authorization, payload-hash, binding-hash, future-time, or expiry drift denies cached-result release and returns no payload.
6. Cross-repository attachment, thread, and export rows can return only `INTEGRATION_HOLD`; names, pins, or apparent local controls cannot promote them to API-proven authorization.
7. The evaluator grants no effect, mutates no business state, performs no read/write/provider call, and cannot produce G1/G2 evidence.

## Mutation cone

- Add one isolated authorization-proof module and focused tests.
- Add the machine-readable SGO-V02 matrix, this contract, taxonomy entry, proof ledger and handoff.
- Do not modify existing identity, C03, Stage 5, command, receipt, route, cache, schema, or migration code.

## Acceptance proof

- The matrix has exactly the five requested surface kinds with all non-API rows held.
- Authorized owner/read, action resume/mutate and exact cache release pass.
- Cross-tenant, second-actor, object mismatch, missing capability, unsupported operation, malformed scope and every cache-binding drift fail closed.
- A second explicitly granted actor still cannot receive the first actor's cached payload.
- Expired cache can recover only through a newly authorized read and newly bound cache envelope; the old envelope stays denied.
- Focused, repository-wide, type, lint, compliance, build, source-pin and reverse/reapply checks pass at exact SHAs.

## Explicit non-scope

- No runtime mounting or route activation.
- No user-session propagation into existing service-to-service routes.
- No attachment, thread, export, action, receipt, cache or object persistence.
- No provider call, deployment, production mutation, migration application, default-branch action, legacy A02 execution, or G1/G2 claim.
