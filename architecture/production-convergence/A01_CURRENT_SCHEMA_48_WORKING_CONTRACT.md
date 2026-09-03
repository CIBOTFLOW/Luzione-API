# A01 Current-Schema 48-Relation Rehearsal Working Contract

## Capability outcome

- Project: controller A01, bounded G0 continuation.
- Base truth: `CIBOTFLOW/Luzione-API@7ee5a0a53a3434c3e00969dc626a4daad33f9dc0` declares 48 security-gated relations.
- Outcome: reproduce the observed 39/48, 69-violation production signature with synthetic structure only; apply the existing ordered migrations in disposable PostgreSQL to reach 48/48 and zero violations; restore the exact pre-change dump and prove the public and authenticated health surfaces fail closed again.

## Entrypoints, owner, and readback

- Public readback: `GET /api/v1/release`, `/livez`, `/readyz`, and `/healthz`.
- Authenticated readback: `GET /api/v1/security/rls-readiness` with `security.rls.read`.
- Canonical owner: PostgreSQL catalog state interpreted by `src/lib/security-posture/readService.ts` and `src/modules/security-posture/rlsPosture.ts`.
- Write owner: the already-reviewed migrations under `supabase/migrations`; this rehearsal creates no migration and applies them only to an ephemeral local database.

## Reused convergence path

The proof reuses, in order:

1. `20260831070000_order_fulfillment_intent_dark_path.sql`;
2. `20260831090000_api_pc_013_least_privilege_roles_rls.sql`;
3. `20260901123000_sultan_agent_policy_envelopes.sql`;
4. `20260901130000_sultan_agent_internal_actions.sql`;
5. `20260902010000_sultan_stage5_authority_outcomes.sql`;
6. `20260902010100_sultan_stage5_post_inference_receipt_constraints.sql`.

No new relation, schema, role, compatibility layer, shared contract version, or mutation path is introduced.

## Invariants and negative proof

- The 48-relation set and 38 forced-tenant-RLS subset are exact and test-sensitive.
- The observed baseline and restored rollback state are exactly 39/48 with 69 violations; neither may be rounded up.
- The candidate is exactly 48/48 with zero violations and five permission-denied active probes.
- `anon` and `authenticated` are actively denied on all 48 relations; legacy `service_role` is actively denied on all 38 tenant relations.
- Runtime sensitive-table access, provider-worker out-of-scope access, missing-tenant visibility, and representative legacy and Stage-5 cross-tenant reads/writes are denied.
- Public health and authenticated RLS readback remain fail closed after rollback while dependency readiness remains independently observable.
- Mutations, internal projections, external effects, production access, managed migration and promotion remain disabled or absent.

## Acceptance proof

- Focused unit tests reject the superseded 47/48 signature and require current 39/48 truth.
- Disposable PostgreSQL proves ordered convergence, API-PC-013 reapplication, current-schema security negatives spanning the Stage-5 tables, dump/restore equality, and fail-closed HTTP readback.
- GitHub Actions checks out and builds the exact pull-request SHA, runs the rehearsal, and publishes an immutable `a01-current-schema-<sha>` artifact.
- Full compliance, typecheck, lint, test, and production build remain required at the same exact SHA.

## Non-scope and irreversible effects

- No production database, data, principal, credential, secret, DNS, alias, deployment protection, default branch, deployment, promotion, or rollback is accessed or changed.
- A managed backup/PITR receipt and any production migration/rollback remain external human G1/G2 prerequisites.
- This proof is `LOCAL_PROVEN`, `NO_EFFECT`, and `BOUNDED_CLAIM`; it is not integration or production readiness.
