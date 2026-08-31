# API-PC-004 Working Contract

Capability outcome: bind actor, tenant and protected-route capability to the authenticated credential, then fail closed when a caller attempts to select a different identity or an ungranted capability.

- Entrypoints: every existing protected `/api/v1` route through `requireServiceActor`; the governance evaluator remains evaluation-only.
- Expected end state: credential-derived actor/tenant/capabilities are bound into request identity before protected work begins.
- Authoritative truth: verified Vercel workload claims plus the API-owned credential mapping; service-token mappings are deployment configuration until canonical membership tables are admitted and read back.
- Write owner: API deployment configuration today; future canonical identity, tenant-membership and capability-grant relations are API/data-lane migrations.
- Readback path: `ApiActor` returned by the credential adapter and the bound `luzione-request-identity/v1` response envelope.
- Consumed contracts: Vercel OIDC identity, `luzione-request-identity/v1`, tenant policy and autonomy constitution.
- Published contract: `luzione-authority-subject/v0.1`.
- Dependencies: API-PC-003 contract v0.1; existing workload-token verification and protected routes.
- Mutation cone: `src/lib/api/actor.ts`, protected route authentication calls, tests, topology/config inventory and contract catalog.
- Reuse/convergence: extend `requireServiceActor`; do not introduce another auth service, identity store or policy engine. Remove the governance route's locally manufactured `CANONICAL_STORE` grant.
- Invariants: request headers are assertions only; credential mappings select identity; tenant mismatch and missing capability fail closed; evaluation cannot mint authority; no A3 or live effect authority is granted.
- Non-scope: database membership migration, production credential changes, human approval persistence, command execution and provider effects.
- Acceptance proof: valid mapped credential, cross-tenant denial, missing-capability denial, all protected routes request an explicit capability, no synthetic canonical grant, full regression suite.
- Irreversible effects: none. No deployment configuration or production database is changed in this cell.
