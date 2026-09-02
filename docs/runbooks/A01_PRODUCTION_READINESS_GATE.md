# A01 Production Readiness Gate

This is a prepared production action, not authorization to run it. The A01
implementation is locally and independently built at
`0d4fa2587b85f6cd50db7f713bf919d6bc7f8f6a`; production remains on
`6f7191f0f5e59153541271ea291f3727015f5741` and correctly fails closed at
39/40 relations. The newer candidate also removes a named prepared statement
that caused intermittent `readyz=503` responses through Supavisor's
transaction pooler.

## Required owners and resources

- Named Supabase production/database owner for project `cfwkqhenhnvnnwpxdjns`.
- Named Vercel release owner for project `prj_hEQQeozR9ZfauHr1QWvxZiZ3A9pQ`.
- A verified managed restore point or PITR window recorded before DDL.
- The database principal referenced by the Vercel `DATABASE_URL`, identified by
  name without recording its secret value. The 2026-09-02 preflight identified
  `luzione_api_readiness`: it is a non-superuser, non-owner, `NOINHERIT` login
  with zero effective public-table privileges and existing `anon`,
  `authenticated` and `luzione_api_projection` memberships.

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
4. Preserve the preflight principal posture. Do not enable `INHERIT` on
   `luzione_api_readiness`: doing so would activate all three of its existing
   memberships as well as any new membership. Do not grant `BYPASSRLS`,
   ownership, destructive table privileges or the worker role. A future
   business-runtime credential or explicit role-assumption path requires a
   separately reviewed A02 change; the A01 readiness path does not justify that
   credential expansion.
5. Deploy the exact candidate through the already-green Release gate. Do not
   enable any command mutation or external-effect flag.

## 2026-09-02 managed preflight

- Supabase project `cfwkqhenhnvnnwpxdjns` is `ACTIVE_HEALTHY` on a Pro
  organization and PostgreSQL 17.6.1.141. Supabase documents daily physical
  backups and seven days of daily-backup access for Pro projects, but the
  connected management surface exposes no backup-list operation. No exact
  backup ID, timestamp, status or PITR window was therefore verified.
- The two candidate migration versions remain absent from managed migration
  history and their repository checksums still match this runbook.
- Production database sessions identify the Vercel pooler login as
  `luzione_api_readiness`; the bounded principal review above passed without a
  credential or role change.
- PostgreSQL logs at `2026-09-02T07:16:56.418Z` and
  `2026-09-02T07:20:53.675Z` show `prepared statement "readiness-v1" already
  exists`. Candidate `0d4fa2587b85f6cd50db7f713bf919d6bc7f8f6a`
  removes that named statement and passes 225/225 tests, Release gate
  `33603316756`, CodeQL `33603316773` and Ready preview
  `7GjEgvN54RoN8JbrSnVS7TFrU7G2`.
- The preview remains protected by Vercel SSO, and the connected Vercel account
  cannot access the project, create a bypass URL, inspect environment metadata,
  promote or roll back it.

The production mutation and promotion remain blocked until a project-specific
managed restore point and Vercel release access are recorded. Plan entitlement
alone is not a restore receipt.

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
