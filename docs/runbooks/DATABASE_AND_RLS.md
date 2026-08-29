# Database and RLS Recovery

Owner: Luzione database and security owner. Scope: Postgres connectivity, TLS and RLS posture.

## Containment

Keep API mutations disabled and block promotion. Never disable TLS verification or RLS as a recovery shortcut.

## Diagnosis and recovery

Use `readyz` to distinguish connectivity from configuration and `security/rls-readiness` or `healthz` for the RLS gate. Inspect only bounded provider codes. Restore the correct pooled connection, CA material, roles, grants and policies through reviewed infrastructure/migrations.

## Verification

Require `select 1`, catalog posture, all expected sensitive relations, and active permission-denied probes where authorized. Verify tenant-scoped readback separately from connectivity.

## Escalation

Escalate schema ownership conflicts before migration. A production restore, role change or policy mutation requires separate authority and an exercised rollback path.
