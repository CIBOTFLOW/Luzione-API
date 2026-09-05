# Seed Project Publication A2 Working Contract

State: bounded local pass; default-off; no deployment or managed migration authorized.

Producer contract SHA: `a654c1d26dd6f93be15fa02cbd6aba344f7acb7a`  
Core seed-product contract base: `e14b405d58a293c002f5676984a95e55372b3bd2`

## Ownership and lifecycle

- Luzione API owns canonical Project, activated Space/Specification/Specification Line, command, receipt, timeline and readback records.
- CRM remains owner of the referenced Opportunity. The API queries the exact tenant-bound Opportunity version and does not copy CRM truth into a second Opportunity table.
- Room Planner owns mutable pre-publication design drafts. It publishes an immutable `ProjectPackage/v1` and may later append only a pending `Specification/v1` revision proposal.
- A2 deliberately stores immutable facts only: Projects and initial activated schedule rows are version 1; revision rows are `PENDING`. Acceptance/rejection and activation of a later canonical Specification version require a future additive disposition/activation contract. A2 cannot overwrite active procurement.
- Every owner insert is deferred-foreign-key bound to the P110 command receipt in the same transaction. All A2 outbox records are `NO_EFFECT`.

## Protected routes

| Method | Route | Result |
|---|---|---|
| GET | `/api/v1/projects` | `{ projects: Project/v1[] }` |
| POST | `/api/v1/projects` | project create receipt plus canonical readback |
| GET | `/api/v1/projects/:projectId` | `ProjectSpecificationScheduleReadModel/v1` |
| GET | `/api/v1/projects/:projectId/specification-schedule` | `ProjectSpecificationScheduleReadModel/v1` |
| GET | `/api/v1/projects/:projectId/project-packages?packageId=...` | exact `ProjectPackage/v1` |
| POST | `/api/v1/projects/:projectId/project-packages` | publication receipt, canonical IDs and readback |
| POST | `/api/v1/projects/:projectId/specification-revisions` | pending revision receipt, canonical IDs, diff and readback |

Successful routes retain the established API envelope:

```text
{
  ok: true,
  responseContractVersion: "api-http-response/1.0",
  result: <route result>,
  requestId,
  correlationId,
  requestIdentityContractVersion,
  traceId
}
```

The temporary UI-owned top-level `schedule` or `projects` envelope is not canonical. Exact list, schedule and revision positive fixtures are exported by `src/modules/seed-project-publication/fixtures.ts`. The schedule metadata records `seedContractProducerSha` separately from runtime `releaseIdentity.exactSha`; clients must validate both and must not promote an unbound deployment.

## Mutation boundary

Commands use `SeedProjectPublicationCommand/v1` and reject surplus fields. Tenant, actor and authority are derived from the authenticated service workload, never the body. Mutations require exact `expectedVersion`, idempotency key, source references and evidence/provenance. Project Package input additionally requires a canonical SHA-256 `packageHash`. Mutation runtime requires the global mutation gate, the A2 gate and an exact tenant allowlist.

## Recovery boundary

The tracked rollback is a pre-admission rehearsal only. It refuses to drop A2 tables if any owner row or matching P110 receipt exists; admitted systems must ship additive forward fixes. No managed Supabase migration, live effect, preview or production behavior was exercised.
