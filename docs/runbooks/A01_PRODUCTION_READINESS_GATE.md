# A01 Production Readiness Gate

This is a prepared production action, not authorization to run it. The A01
implementation is locally and independently built at
`00d345eb29ecff3a8b031276a58d24b2a73972f1`; production remains on
`6f7191f0f5e59153541271ea291f3727015f5741` and correctly fails closed at
39/40 relations.

## Required owners and resources

- Named Supabase production/database owner for project `cfwkqhenhnvnnwpxdjns`.
- Named Vercel release owner for project `prj_hEQQeozR9ZfauHr1QWvxZiZ3A9pQ`.
- A verified managed restore point or PITR window recorded before DDL.
- The database principal referenced by the Vercel `DATABASE_URL`, identified by
  name without recording its secret value.

## Prepared change

1. Confirm production mutations remain `DISABLED_FAIL_CLOSED` and create the
   managed restore point.
2. Verify the live catalog still has the A01 signature: only
   `public.order_fulfillment_intents` is missing; 29 convergence relations are
   not forced and retain `service_role` SELECT; both least-privilege group roles
   are absent.
3. Apply, in order, the exact repository files:
   - `supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql`
     (`sha256:a179b3d6d38fbdb7e9fc6ab1179e0f60572f43062c6ba7ea45ca8583794fa982`)
   - `supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql`
     (`sha256:281615cbd3c421fe40893ca415cef25b645ed033c6e9573d6c3540b8ac803dc1`)
4. Bind the deployed login principal to `luzione_api_runtime` only after its
   exact current privileges and connection-pool behavior have been reviewed.
   Do not grant `BYPASSRLS`, ownership, login, destructive table privileges or
   the worker role to the web principal.
5. Deploy the exact candidate through the already-green Release gate. Do not
   enable any command mutation or external-effect flag.

## Acceptance readback

- `GET /api/v1/release` reports the exact promoted SHA and immutable deployment
  ID.
- `GET /api/v1/livez` returns 200 for that SHA.
- `GET /api/v1/readyz` returns 200 with database `READY`.
- An authenticated `GET /api/v1/security/rls-readiness` with
  `security.rls.read` reports 40/40, zero violations and four permission-denied
  active probes.
- `GET /api/v1/healthz` returns 200 for the same SHA, while mutations remain
  disabled and external effects remain unauthorized.

## Failure and rollback

- Any migration statement failure rolls back its enclosing transaction; do not
  promote the application.
- If post-commit catalog or application readback fails, stop traffic promotion,
  preserve the failed evidence, and restore the named pre-change managed restore
  point. Then redeploy immutable production deployment
  `dpl_3TCkqyjzYwebcrDpjAdaw69Hc7SZ` and re-run `livez`, `readyz`, `healthz` and
  the authenticated posture readback.
- Do not drop a role while it owns or grants production objects. Do not use a
  hand-written partial reversal as a substitute for the verified restore point.
- The repository proves this sequence with a disposable PostgreSQL 16 dump and
  restore. Managed PITR/restore has not been exercised, so production execution
  remains blocked until the database owner records that recovery evidence.
